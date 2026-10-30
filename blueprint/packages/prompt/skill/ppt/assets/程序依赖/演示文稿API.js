import { unzipSync, zipSync } from "./压缩.mjs";
//#region src/api/units.ts
const EMU_PER_INCH = 914400;
const EMU_PER_CM = 36e4;
const EMU_PER_PT = 12700;
const inches = (n) => Math.round(n * EMU_PER_INCH);
const cm = (n) => Math.round(n * EMU_PER_CM);
const mm = (n) => Math.round(n * EMU_PER_CM / 10);
const pt = (n) => Math.round(n * EMU_PER_PT);
const emu = (n) => Math.round(n);
//#endregion
//#region src/internal/opc/zip.ts
const STORE_BY_EXTENSION = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"bmp",
	"tif",
	"tiff",
	"webp",
	"mp3",
	"mp4",
	"m4a",
	"m4v",
	"wav",
	"wmv",
	"mov",
	"avi",
	"webm",
	"ogg",
	"wma",
	"pdf",
	"zip",
	"gz",
	"7z",
	"rar"
]);
const extensionOf = (name) => {
	const dot = name.lastIndexOf(".");
	return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};
/**
* Returns true if the entry should be stored uncompressed. PPTX writers
* conventionally STORE already-compressed payloads to avoid wasting CPU on
* negligible savings.
*/
const shouldStore = (name) => STORE_BY_EXTENSION.has(extensionOf(name));
/**
* Reads a ZIP archive (a `.pptx` file is a ZIP) and returns entries in
* central-directory order. Throws if `input` is not a valid ZIP.
*/
const readZip = (input) => {
	const obj = unzipSync(input);
	const entries = [];
	for (const name of Object.keys(obj)) {
		const data = obj[name];
		if (data === void 0) continue;
		entries.push({
			name,
			data
		});
	}
	return { entries };
};
const writeZip = (entries, options = {}) => {
	const defaultLevel = options.level ?? 6;
	const obj = {};
	for (const e of entries) {
		const level = shouldStore(e.name) ? 0 : defaultLevel;
		obj[e.name] = [e.data, { level }];
	}
	return zipSync(obj);
};
//#endregion
//#region src/internal/opc/part-name.ts
/**
* Asserts the given string is a syntactically valid OPC part name and returns
* it as a branded `PartName`. Throws otherwise.
*
* Rules enforced (subset; see ECMA-376 Part 2 §9.1.1.1-9.1.1.6):
*
*   - Must start with `/`.
*   - Must not end with `/`.
*   - Must not contain `//` (empty segments).
*   - Each segment must be non-empty and must not be `.` or `..`.
*/
const partName = (raw) => {
	if (raw === "") throw new Error("part name is empty");
	if (!raw.startsWith("/")) throw new Error(`part name must start with "/": ${raw}`);
	if (raw.length > 1 && raw.endsWith("/")) throw new Error(`part name must not end with "/": ${raw}`);
	const segments = raw.slice(1).split("/");
	for (const s of segments) {
		if (s === "") throw new Error(`part name contains empty segment: ${raw}`);
		if (s === "." || s === "..") throw new Error(`part name contains "." or ".." segment: ${raw}`);
	}
	return raw;
};
/** Convert a part name to the corresponding ZIP entry path (no leading slash). */
const toZipPath = (name) => name.slice(1);
/** Convert a ZIP entry path to a part name (adds leading slash). */
const fromZipPath = (zipPath) => partName(`/${zipPath}`);
/** Case-insensitive part name equality per OPC §9.1.1.7. */
const partNamesEqual = (a, b) => a.toLowerCase() === b.toLowerCase();
/**
* Returns the directory portion of a part name (everything before the final
* `/`). The result keeps the leading slash but has no trailing slash, except
* for the root which returns `/`.
*/
const dirname = (name) => {
	const idx = name.lastIndexOf("/");
	if (idx <= 0) return "/";
	return name.slice(0, idx);
};
/** Returns the file portion of a part name (everything after the final `/`). */
const basename = (name) => {
	const idx = name.lastIndexOf("/");
	return idx < 0 ? name : name.slice(idx + 1);
};
/**
* Computes the part name of the `.rels` file that holds relationships
* originating from `name`. Per OPC §9.3.2: for a part `/x/y/z.xml` the rels
* file is `/x/y/_rels/z.xml.rels`. The package-root rels file is `/_rels/.rels`.
*/
const relsPartNameFor = (name) => {
	const dir = dirname(name);
	const file = basename(name);
	return partName(`${dir === "/" ? "/_rels/" : `${dir}/_rels/`}${file}.rels`);
};
/**
* Resolves a relationship Target (which may be relative) against a base part
* name. Returns the absolute part name (always starts with `/`).
*
* `target` is from a Relationship element's `Target` attribute when
* `TargetMode="Internal"`. External targets must not be passed through here.
*/
const resolveTarget = (basePart, target) => {
	if (target === "") throw new Error("relationship target is empty");
	if (target.startsWith("/")) return partName(target);
	const baseDir = dirname(basePart);
	const stack = baseDir === "/" ? [] : baseDir.slice(1).split("/");
	for (const segment of target.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (stack.length === 0) throw new Error(`relationship target "${target}" escapes the package root`);
			stack.pop();
			continue;
		}
		stack.push(segment);
	}
	return partName(`/${stack.join("/")}`);
};
//#endregion
//#region src/internal/xml/ast.ts
const qname = (prefix, localName, namespaceURI) => ({
	prefix,
	localName,
	namespaceURI
});
const attr = (name, value) => ({
	name,
	value
});
const elem = (name, init = {}) => ({
	kind: "element",
	name,
	attrs: init.attrs ?? [],
	prefixDecls: init.prefixDecls ?? /* @__PURE__ */ new Map(),
	children: init.children ?? []
});
const text = (data) => ({
	kind: "text",
	data
});
const cdata = (data) => ({
	kind: "cdata",
	data
});
const comment = (data) => ({
	kind: "comment",
	data
});
const pi = (target, data) => ({
	kind: "pi",
	target,
	data
});
const qnameEquals = (a, b) => a.localName === b.localName && a.namespaceURI === b.namespaceURI;
/**
* Inserts `element` into `parent.children` at the slot dictated by `rankOf`,
* keeping element children ordered by ascending rank (stable for equal ranks).
*
* Many OOXML complex types are `xsd:sequence`s: a child must appear in a fixed
* order relative to its siblings or the part fails schema validation. Setters
* that `push`/`unshift` produce valid output only when the caller happens to
* invoke them in schema order — fragile across independent mutation calls.
* Callers should strip any pre-existing same-element first, then use this to
* drop the new element at its mandated position regardless of call order.
*
* `rankOf` returns the sibling's sequence position; return a large number for
* trailing/unknown children so they sort to the end. Non-element nodes are
* skipped when scanning, and the new element lands before the first existing
* element whose rank is strictly greater.
*/
const insertChildByRank = (parent, element, rankOf) => {
	const rank = rankOf(element);
	let idx = parent.children.length;
	for (let i = 0; i < parent.children.length; i++) {
		const child = parent.children[i];
		if (child?.kind !== "element") continue;
		if (rankOf(child) > rank) {
			idx = i;
			break;
		}
	}
	parent.children.splice(idx, 0, element);
};
//#endregion
//#region src/internal/xml/namespaces.ts
const NS = {
	contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
	relationships: "http://schemas.openxmlformats.org/package/2006/relationships",
	officeDocRels: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
	pml: "http://schemas.openxmlformats.org/presentationml/2006/main",
	dml: "http://schemas.openxmlformats.org/drawingml/2006/main",
	diagram: "http://schemas.openxmlformats.org/drawingml/2006/diagram",
	chart: "http://schemas.openxmlformats.org/drawingml/2006/chart",
	chartDrawing: "http://schemas.openxmlformats.org/drawingml/2006/chartDrawing",
	sml: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
	wml: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
	mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
	a14: "http://schemas.microsoft.com/office/drawing/2010/main",
	a15: "http://schemas.microsoft.com/office/drawing/2012/main",
	a16: "http://schemas.microsoft.com/office/drawing/2014/main",
	p14: "http://schemas.microsoft.com/office/powerpoint/2010/main",
	p15: "http://schemas.microsoft.com/office/powerpoint/2012/main",
	p16: "http://schemas.microsoft.com/office/powerpoint/2015/main",
	xml: "http://www.w3.org/XML/1998/namespace",
	xmlns: "http://www.w3.org/2000/xmlns/"
};
NS.contentTypes, NS.relationships, NS.officeDocRels, NS.pml, NS.dml, NS.diagram, NS.chart, NS.chartDrawing, NS.sml, NS.wml, NS.mc, NS.a14, NS.a15, NS.a16, NS.p14, NS.p15, NS.p16, NS.xml;
//#endregion
//#region src/internal/xml/parse.ts
var XmlParseError = class extends Error {
	offset;
	line;
	column;
	constructor(message, offset, line, column) {
		super(`${message} at line ${line}:${column} (offset ${offset})`);
		this.offset = offset;
		this.line = line;
		this.column = column;
		this.name = "XmlParseError";
	}
};
const isNameStartChar = (c) => {
	const code = c.charCodeAt(0);
	return code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 95 || code === 58;
};
const isNameChar = (c) => {
	if (isNameStartChar(c)) return true;
	const code = c.charCodeAt(0);
	return code >= 48 && code <= 57 || code === 45 || code === 46;
};
const isWhitespace = (c) => c === " " || c === "	" || c === "\n" || c === "\r";
const lineColOf = (src, pos) => {
	let line = 1;
	let column = 1;
	for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) {
		line++;
		column = 1;
	} else column++;
	return {
		line,
		column
	};
};
const fail = (cur, message) => {
	const { line, column } = lineColOf(cur.src, cur.pos);
	throw new XmlParseError(message, cur.pos, line, column);
};
const expect = (cur, literal) => {
	if (cur.src.slice(cur.pos, cur.pos + literal.length) !== literal) fail(cur, `expected "${literal}"`);
	cur.pos += literal.length;
};
const accept = (cur, literal) => {
	if (cur.src.slice(cur.pos, cur.pos + literal.length) !== literal) return false;
	cur.pos += literal.length;
	return true;
};
const skipWhitespace = (cur) => {
	while (cur.pos < cur.src.length && isWhitespace(cur.src[cur.pos] ?? "")) cur.pos++;
};
const readName = (cur) => {
	const start = cur.pos;
	if (cur.pos >= cur.src.length || !isNameStartChar(cur.src[cur.pos] ?? "")) fail(cur, "expected XML name");
	cur.pos++;
	while (cur.pos < cur.src.length && isNameChar(cur.src[cur.pos] ?? "")) cur.pos++;
	return cur.src.slice(start, cur.pos);
};
const splitQName = (raw) => {
	const idx = raw.indexOf(":");
	if (idx < 0) return {
		prefix: "",
		localName: raw
	};
	return {
		prefix: raw.slice(0, idx),
		localName: raw.slice(idx + 1)
	};
};
const decodeRefs = (cur, raw) => {
	let out = "";
	let i = 0;
	while (i < raw.length) {
		if (raw.charCodeAt(i) !== 38) {
			out += raw[i];
			i++;
			continue;
		}
		const end = raw.indexOf(";", i + 1);
		if (end < 0) {
			cur.pos -= raw.length - i;
			fail(cur, "unterminated entity reference");
		}
		const ref = raw.slice(i + 1, end);
		if (ref === "amp") out += "&";
		else if (ref === "lt") out += "<";
		else if (ref === "gt") out += ">";
		else if (ref === "quot") out += "\"";
		else if (ref === "apos") out += "'";
		else if (ref.startsWith("#x") || ref.startsWith("#X")) {
			const code = Number.parseInt(ref.slice(2), 16);
			if (!Number.isFinite(code)) fail(cur, `invalid hex numeric reference: &${ref};`);
			out += String.fromCodePoint(code);
		} else if (ref.startsWith("#")) {
			const code = Number.parseInt(ref.slice(1), 10);
			if (!Number.isFinite(code)) fail(cur, `invalid decimal numeric reference: &${ref};`);
			out += String.fromCodePoint(code);
		} else fail(cur, `unknown entity reference: &${ref};`);
		i = end + 1;
	}
	return out;
};
const readAttrValue = (cur) => {
	const quote = cur.src[cur.pos];
	if (quote !== "\"" && quote !== "'") fail(cur, "expected attribute value");
	cur.pos++;
	const start = cur.pos;
	while (cur.pos < cur.src.length && cur.src[cur.pos] !== quote) {
		if (cur.src.charCodeAt(cur.pos) === 60) fail(cur, "\"<\" is not allowed inside an attribute value");
		cur.pos++;
	}
	if (cur.pos >= cur.src.length) fail(cur, "unterminated attribute value");
	const raw = cur.src.slice(start, cur.pos);
	cur.pos++;
	return decodeRefs(cur, raw);
};
const xmlScope = {
	parent: null,
	bindings: new Map([["xml", NS.xml]])
};
const resolvePrefix = (scope, prefix) => {
	let cursor = scope;
	while (cursor) {
		const found = cursor.bindings.get(prefix);
		if (found !== void 0) return found;
		cursor = cursor.parent;
	}
	return null;
};
const resolveQName = (cur, scope, raw, isAttribute) => {
	const { prefix, localName } = splitQName(raw);
	let namespaceURI = "";
	if (prefix !== "") {
		const found = resolvePrefix(scope, prefix);
		if (found === null) return fail(cur, `unbound namespace prefix "${prefix}"`);
		namespaceURI = found;
	} else if (!isAttribute) namespaceURI = resolvePrefix(scope, "") ?? "";
	return qname(prefix, localName, namespaceURI);
};
const parseDeclaration = (cur) => {
	if (!accept(cur, "<?xml")) return null;
	const end = cur.src.indexOf("?>", cur.pos);
	if (end < 0) fail(cur, "unterminated XML declaration");
	const body = cur.src.slice(cur.pos, end);
	cur.pos = end + 2;
	const get = (key) => {
		return body.match(new RegExp(`\\b${key}\\s*=\\s*(['"])(.*?)\\1`))?.[2];
	};
	const version = get("version");
	if (version === void 0) return fail(cur, "XML declaration missing \"version\"");
	const encoding = get("encoding");
	const standaloneRaw = get("standalone");
	let standalone;
	if (standaloneRaw === "yes" || standaloneRaw === "no") standalone = standaloneRaw;
	else if (standaloneRaw !== void 0) return fail(cur, `invalid standalone value "${standaloneRaw}"`);
	return {
		version,
		...encoding !== void 0 ? { encoding } : {},
		...standalone !== void 0 ? { standalone } : {}
	};
};
const parseComment = (cur) => {
	expect(cur, "<!--");
	const end = cur.src.indexOf("-->", cur.pos);
	if (end < 0) fail(cur, "unterminated comment");
	const data = cur.src.slice(cur.pos, end);
	if (data.includes("--")) fail(cur, "\"--\" is not allowed inside an XML comment");
	cur.pos = end + 3;
	return comment(data);
};
const parsePI = (cur) => {
	expect(cur, "<?");
	const targetStart = cur.pos;
	while (cur.pos < cur.src.length && !isWhitespace(cur.src[cur.pos] ?? "") && cur.src.slice(cur.pos, cur.pos + 2) !== "?>") cur.pos++;
	const target = cur.src.slice(targetStart, cur.pos);
	if (target.toLowerCase() === "xml") fail(cur, "PI target may not be \"xml\"");
	skipWhitespace(cur);
	const end = cur.src.indexOf("?>", cur.pos);
	if (end < 0) fail(cur, "unterminated processing instruction");
	const data = cur.src.slice(cur.pos, end);
	cur.pos = end + 2;
	return pi(target, data);
};
const parseCData = (cur) => {
	expect(cur, "<![CDATA[");
	const end = cur.src.indexOf("]]>", cur.pos);
	if (end < 0) fail(cur, "unterminated CDATA section");
	const data = cur.src.slice(cur.pos, end);
	cur.pos = end + 3;
	return cdata(data);
};
const skipDoctype = (cur) => {
	expect(cur, "<!DOCTYPE");
	while (cur.pos < cur.src.length) {
		const c = cur.src[cur.pos];
		if (c === "[") fail(cur, "DOCTYPE internal subset is not supported");
		if (c === ">") {
			cur.pos++;
			return;
		}
		cur.pos++;
	}
	fail(cur, "unterminated DOCTYPE");
};
const parseStartOrEmptyTag = (cur, parentScope) => {
	expect(cur, "<");
	const rawName = readName(cur);
	const ownAttrs = [];
	const prefixDecls = /* @__PURE__ */ new Map();
	let empty = false;
	while (true) {
		const wsStart = cur.pos;
		skipWhitespace(cur);
		if (cur.pos === wsStart && cur.src[cur.pos] !== "/" && cur.src[cur.pos] !== ">") fail(cur, "expected whitespace before next attribute");
		if (accept(cur, "/>")) {
			empty = true;
			break;
		}
		if (accept(cur, ">")) break;
		const attrRawName = readName(cur);
		skipWhitespace(cur);
		expect(cur, "=");
		skipWhitespace(cur);
		const value = readAttrValue(cur);
		if (attrRawName === "xmlns") prefixDecls.set("", value);
		else if (attrRawName.startsWith("xmlns:")) {
			const p = attrRawName.slice(6);
			if (p === "") fail(cur, "empty namespace prefix in xmlns:");
			if (p === "xmlns") fail(cur, "prefix \"xmlns\" cannot be redeclared");
			prefixDecls.set(p, value);
		} else ownAttrs.push({
			raw: attrRawName,
			rawValue: value
		});
	}
	const scope = {
		parent: parentScope,
		bindings: new Map(prefixDecls)
	};
	return {
		element: elem(resolveQName(cur, scope, rawName, false), {
			attrs: ownAttrs.map(({ raw, rawValue }) => attr(resolveQName(cur, scope, raw, true), rawValue)),
			prefixDecls,
			children: []
		}),
		scope,
		empty
	};
};
const parseEndTag = (cur) => {
	expect(cur, "</");
	const name = readName(cur);
	skipWhitespace(cur);
	expect(cur, ">");
	return name;
};
const parseTextContent = (cur) => {
	const start = cur.pos;
	while (cur.pos < cur.src.length && cur.src.charCodeAt(cur.pos) !== 60) cur.pos++;
	return decodeRefs(cur, cur.src.slice(start, cur.pos));
};
const parseElement = (cur, parentScope) => {
	const { element, scope, empty } = parseStartOrEmptyTag(cur, parentScope);
	if (empty) return element;
	while (cur.pos < cur.src.length) if (cur.src.charCodeAt(cur.pos) === 60) {
		if (cur.src.startsWith("</", cur.pos)) {
			const closingRaw = parseEndTag(cur);
			const expectedRaw = element.name.prefix === "" ? element.name.localName : `${element.name.prefix}:${element.name.localName}`;
			if (closingRaw !== expectedRaw) fail(cur, `mismatched closing tag: expected </${expectedRaw}>, got </${closingRaw}>`);
			return element;
		}
		if (cur.src.startsWith("<![CDATA[", cur.pos)) element.children.push(parseCData(cur));
		else if (cur.src.startsWith("<!--", cur.pos)) element.children.push(parseComment(cur));
		else if (cur.src.startsWith("<?", cur.pos)) element.children.push(parsePI(cur));
		else element.children.push(parseElement(cur, scope));
	} else {
		const t = parseTextContent(cur);
		if (t.length > 0) element.children.push(text(t));
	}
	return fail(cur, `unterminated element <${element.name.localName}>`);
};
const parseXml = (src) => {
	const cur = {
		src: (src.charCodeAt(0) === 65279 ? src.slice(1) : src).replace(/\r\n?/g, "\n"),
		pos: 0
	};
	const decl = parseDeclaration(cur);
	skipWhitespace(cur);
	const prolog = [];
	while (cur.pos < cur.src.length) {
		skipWhitespace(cur);
		if (cur.src.startsWith("<!--", cur.pos)) prolog.push(parseComment(cur));
		else if (cur.src.startsWith("<!DOCTYPE", cur.pos)) skipDoctype(cur);
		else if (cur.src.startsWith("<?", cur.pos)) prolog.push(parsePI(cur));
		else break;
	}
	skipWhitespace(cur);
	if (cur.pos >= cur.src.length || cur.src[cur.pos] !== "<") fail(cur, "expected root element");
	const root = parseElement(cur, xmlScope);
	const epilog = [];
	while (cur.pos < cur.src.length) {
		skipWhitespace(cur);
		if (cur.pos >= cur.src.length) break;
		if (cur.src.startsWith("<!--", cur.pos)) epilog.push(parseComment(cur));
		else if (cur.src.startsWith("<?", cur.pos)) epilog.push(parsePI(cur));
		else fail(cur, "unexpected content after root element");
	}
	return {
		kind: "document",
		decl,
		prolog,
		root,
		epilog
	};
};
//#endregion
//#region src/internal/xml/query.ts
const isElement = (n) => n.kind === "element";
const childElements = (e) => e.children.filter(isElement);
const firstChildElement = (e, name) => {
	for (const c of e.children) if (isElement(c) && qnameEquals(c.name, name)) return c;
	return null;
};
const allChildElements = (e, name) => {
	const out = [];
	for (const c of e.children) if (isElement(c) && qnameEquals(c.name, name)) out.push(c);
	return out;
};
const getAttr = (e, name) => {
	for (const a of e.attrs) if (qnameEquals(a.name, name)) return a;
	return null;
};
const getAttrValue = (e, name) => getAttr(e, name)?.value ?? null;
/**
* Returns the concatenated text content of an element, walking into nested
* elements. OOXML uses this pattern for `<a:t>Hello</a:t>` (single text
* child) and for run sequences where multiple text nodes need merging.
*/
const textContent = (e) => {
	let out = "";
	for (const c of e.children) if (c.kind === "text") out += c.data;
	else if (c.kind === "cdata") out += c.data;
	else if (c.kind === "element") out += textContent(c);
	return out;
};
/**
* Walks the element tree depth-first, yielding every element including the
* root. The visitor returns `false` to skip descending into the current
* element's children. Returning nothing (or `true`) descends as usual.
*/
const walkElements = (root, visit) => {
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		if (visit(node) === false) continue;
		for (let i = node.children.length - 1; i >= 0; i--) {
			const c = node.children[i];
			if (c && isElement(c)) stack.push(c);
		}
	}
};
//#endregion
//#region src/internal/xml/serialize.ts
const rejectForbiddenChar = (c) => {
	const control = c < 32 && c !== 9 && c !== 10 && c !== 13;
	if (control || c >= 55296 && c <= 57343 || c === 65534 || c === 65535) {
		const hex = c.toString(16).toUpperCase().padStart(4, "0");
		throw new Error(`XML-illegal ${control ? "control character" : "character"} U+${hex} in text; strip ${control ? "control" : "illegal"} characters before authoring`);
	}
};
const escapeAttr = (s) => {
	let out = "";
	for (const char of s) {
		const c = char.codePointAt(0);
		rejectForbiddenChar(c);
		if (c === 38) out += "&amp;";
		else if (c === 60) out += "&lt;";
		else if (c === 62) out += "&gt;";
		else if (c === 34) out += "&quot;";
		else if (c === 9) out += "&#9;";
		else if (c === 10) out += "&#10;";
		else if (c === 13) out += "&#13;";
		else out += char;
	}
	return out;
};
const escapeText = (s) => {
	let out = "";
	for (const char of s) {
		const c = char.codePointAt(0);
		rejectForbiddenChar(c);
		if (c === 38) out += "&amp;";
		else if (c === 60) out += "&lt;";
		else if (c === 62) out += "&gt;";
		else if (c === 13) out += "&#13;";
		else out += char;
	}
	return out;
};
const rawName = (prefix, localName) => prefix === "" ? localName : `${prefix}:${localName}`;
const writeAttr = (a) => {
	return ` ${rawName(a.name.prefix, a.name.localName)}="${escapeAttr(a.value)}"`;
};
const writeElement = (e, parts) => {
	const name = rawName(e.name.prefix, e.name.localName);
	parts.push("<");
	parts.push(name);
	for (const [prefix, uri] of e.prefixDecls) {
		const decl = prefix === "" ? "xmlns" : `xmlns:${prefix}`;
		parts.push(` ${decl}="${escapeAttr(uri)}"`);
	}
	for (const a of e.attrs) parts.push(writeAttr(a));
	if (e.children.length === 0) {
		parts.push("/>");
		return;
	}
	parts.push(">");
	for (const child of e.children) writeNode(child, parts);
	parts.push("</");
	parts.push(name);
	parts.push(">");
};
const writeNode = (n, parts) => {
	switch (n.kind) {
		case "element":
			writeElement(n, parts);
			return;
		case "text":
			parts.push(escapeText(n.data));
			return;
		case "cdata":
			parts.push("<![CDATA[");
			parts.push(n.data.split("]]>").join("]]]]><![CDATA[>"));
			parts.push("]]>");
			return;
		case "comment":
			parts.push("<!--");
			parts.push(n.data);
			parts.push("-->");
			return;
		case "pi":
			parts.push("<?");
			parts.push(n.target);
			if (n.data.length > 0) {
				parts.push(" ");
				parts.push(n.data);
			}
			parts.push("?>");
			return;
	}
};
const writeDeclaration = (doc, parts) => {
	if (!doc.decl) return;
	parts.push("<?xml version=\"");
	parts.push(escapeAttr(doc.decl.version));
	parts.push("\"");
	if (doc.decl.encoding !== void 0) {
		parts.push(" encoding=\"");
		parts.push(escapeAttr(doc.decl.encoding));
		parts.push("\"");
	}
	if (doc.decl.standalone !== void 0) {
		parts.push(" standalone=\"");
		parts.push(doc.decl.standalone);
		parts.push("\"");
	}
	parts.push("?>");
};
const serializeXml = (doc, options = {}) => {
	const parts = [];
	if (doc.decl) writeDeclaration(doc, parts);
	else if (options.standaloneDeclaration ?? true) parts.push("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
	for (const p of doc.prolog) writeNode(p, parts);
	writeElement(doc.root, parts);
	for (const e of doc.epilog) writeNode(e, parts);
	return parts.join("");
};
//#endregion
//#region src/internal/opc/content-types.ts
const CT_NS = NS.contentTypes;
const NAME_TYPES = qname("", "Types", CT_NS);
const NAME_DEFAULT = qname("", "Default", CT_NS);
const NAME_OVERRIDE = qname("", "Override", CT_NS);
const ATTR_EXTENSION = qname("", "Extension", "");
const ATTR_CONTENT_TYPE = qname("", "ContentType", "");
const ATTR_PART_NAME = qname("", "PartName", "");
const getAttrValueRaw = (e, local) => {
	for (const a of e.attrs) if (a.name.localName === local) return a.value;
	return null;
};
const parseContentTypes = (xml) => {
	const doc = parseXml(xml);
	if (doc.root.name.namespaceURI !== CT_NS || doc.root.name.localName !== "Types") throw new Error(`expected root <Types xmlns="${CT_NS}">, got <${doc.root.name.localName}>`);
	const defaults = [];
	const overrides = [];
	for (const child of doc.root.children) {
		if (child.kind !== "element") continue;
		if (child.name.namespaceURI !== CT_NS) continue;
		if (child.name.localName === "Default") {
			const ext = getAttrValueRaw(child, "Extension");
			const ct = getAttrValueRaw(child, "ContentType");
			if (ext === null || ct === null) throw new Error("Content_Types Default missing Extension or ContentType");
			defaults.push({
				extension: ext.toLowerCase(),
				contentType: ct
			});
		} else if (child.name.localName === "Override") {
			const pn = getAttrValueRaw(child, "PartName");
			const ct = getAttrValueRaw(child, "ContentType");
			if (pn === null || ct === null) throw new Error("Content_Types Override missing PartName or ContentType");
			overrides.push({
				partName: partName(pn),
				contentType: ct
			});
		}
	}
	return {
		defaults,
		overrides
	};
};
const serializeContentTypes = (ct) => {
	const children = [...ct.defaults.map((d) => elem(NAME_DEFAULT, { attrs: [{
		name: ATTR_EXTENSION,
		value: d.extension
	}, {
		name: ATTR_CONTENT_TYPE,
		value: d.contentType
	}] })), ...ct.overrides.map((o) => elem(NAME_OVERRIDE, { attrs: [{
		name: ATTR_PART_NAME,
		value: o.partName
	}, {
		name: ATTR_CONTENT_TYPE,
		value: o.contentType
	}] }))];
	return serializeXml({
		kind: "document",
		decl: {
			version: "1.0",
			encoding: "UTF-8",
			standalone: "yes"
		},
		prolog: [],
		root: elem(NAME_TYPES, {
			prefixDecls: new Map([["", CT_NS]]),
			children
		}),
		epilog: []
	});
};
/**
* Resolves the content type for a given part name.
*
*   1. The first Override whose PartName matches case-insensitively wins.
*   2. Otherwise, the first Default whose Extension matches the part's
*      extension (case-insensitive) wins.
*   3. Returns `null` if neither rule matches — `[Content_Types].xml` is
*      required to cover every part, so a null here indicates a malformed
*      package.
*/
const lookupContentType = (ct, name) => {
	for (const o of ct.overrides) if (partNamesEqual(o.partName, name)) return o.contentType;
	const file = basename(name);
	const dot = file.lastIndexOf(".");
	if (dot < 0) return null;
	const ext = file.slice(dot + 1).toLowerCase();
	for (const d of ct.defaults) if (d.extension.toLowerCase() === ext) return d.contentType;
	return null;
};
/**
* Convenience: a fresh ContentTypes seeded with the two defaults every PPTX
* has (`xml` and `rels`). Authoring code can layer overrides on top.
*/
const emptyContentTypes = () => ({
	defaults: [{
		extension: "rels",
		contentType: "application/vnd.openxmlformats-package.relationships+xml"
	}, {
		extension: "xml",
		contentType: "application/xml"
	}],
	overrides: []
});
//#endregion
//#region src/internal/opc/rels.ts
const REL_NS = NS.relationships;
const NAME_RELATIONSHIPS = qname("", "Relationships", REL_NS);
const NAME_RELATIONSHIP = qname("", "Relationship", REL_NS);
const ATTR_ID$16 = qname("", "Id", "");
const ATTR_TYPE$7 = qname("", "Type", "");
const ATTR_TARGET = qname("", "Target", "");
const ATTR_TARGET_MODE = qname("", "TargetMode", "");
const findAttr = (e, local) => {
	for (const a of e.attrs) if (a.name.localName === local) return a.value;
	return null;
};
const parseRels = (xml) => {
	const doc = parseXml(xml);
	if (doc.root.name.namespaceURI !== REL_NS || doc.root.name.localName !== "Relationships") throw new Error(`expected root <Relationships xmlns="${REL_NS}">, got <${doc.root.name.localName}>`);
	const items = [];
	for (const child of doc.root.children) {
		if (child.kind !== "element") continue;
		if (child.name.namespaceURI !== REL_NS || child.name.localName !== "Relationship") continue;
		const id = findAttr(child, "Id");
		const type = findAttr(child, "Type");
		const target = findAttr(child, "Target");
		if (id === null || type === null || target === null) throw new Error("Relationship missing Id, Type, or Target");
		const modeRaw = findAttr(child, "TargetMode");
		let targetMode = "Internal";
		if (modeRaw !== null) {
			if (modeRaw !== "Internal" && modeRaw !== "External") throw new Error(`invalid TargetMode "${modeRaw}"`);
			targetMode = modeRaw;
		}
		items.push({
			id,
			type,
			target,
			targetMode
		});
	}
	return { items };
};
const serializeRels = (rels) => {
	const children = rels.items.map((r) => {
		const attrs = [
			{
				name: ATTR_ID$16,
				value: r.id
			},
			{
				name: ATTR_TYPE$7,
				value: r.type
			},
			{
				name: ATTR_TARGET,
				value: r.target
			}
		];
		if (r.targetMode === "External") attrs.push({
			name: ATTR_TARGET_MODE,
			value: "External"
		});
		return elem(NAME_RELATIONSHIP, { attrs });
	});
	return serializeXml({
		kind: "document",
		decl: {
			version: "1.0",
			encoding: "UTF-8",
			standalone: "yes"
		},
		prolog: [],
		root: elem(NAME_RELATIONSHIPS, {
			prefixDecls: new Map([["", REL_NS]]),
			children
		}),
		epilog: []
	});
};
/**
* Convenience: an empty Relationships value with no items.
*/
const emptyRels = () => ({ items: [] });
/**
* Returns the next free `rId<N>` id given a list of existing ids. The OPC
* spec doesn't require this naming pattern, but PowerPoint emits it and our
* authoring code follows suit so output diffs cleanly against PowerPoint.
*/
const nextRelId = (existing) => {
	let max = 0;
	for (const id of existing) {
		const m = id.match(/^rId(\d+)$/);
		if (m?.[1] !== void 0) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n) && n > max) max = n;
		}
	}
	return `rId${max + 1}`;
};
//#endregion
//#region src/internal/opc/image-format.ts
const startsWith = (bytes, signature) => {
	if (bytes.length < signature.length) return false;
	for (let i = 0; i < signature.length; i++) if (bytes[i] !== signature[i]) return false;
	return true;
};
const decoder$1 = new TextDecoder("utf-8", { fatal: false });
/**
* Detects the image format from raw bytes. Returns `null` if no known
* signature matches — callers should treat that as a hard error and surface
* a message asking for a recognized format.
*/
const detectImageFormat = (bytes) => {
	if (startsWith(bytes, [
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	])) return "png";
	if (startsWith(bytes, [
		255,
		216,
		255
	])) return "jpeg";
	if (startsWith(bytes, [
		71,
		73,
		70,
		56
	])) return "gif";
	if (startsWith(bytes, [66, 77])) return "bmp";
	if (startsWith(bytes, [
		73,
		73,
		42,
		0
	])) return "tiff";
	if (startsWith(bytes, [
		77,
		77,
		0,
		42
	])) return "tiff";
	if (bytes.length >= 12 && startsWith(bytes, [
		82,
		73,
		70,
		70
	]) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "webp";
	const head = decoder$1.decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
	if (/<svg[\s>]/.test(head)) return "svg";
	return null;
};
const readUint16Be = (bytes, at) => bytes[at] << 8 | bytes[at + 1];
const readUint32Be = (bytes, at) => (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;
const pngSize = (bytes) => {
	if (bytes.length < 24) return null;
	const width = readUint32Be(bytes, 16);
	const height = readUint32Be(bytes, 20);
	if (width <= 0 || height <= 0) return null;
	return {
		width,
		height
	};
};
const JPEG_SOF_EXCLUDED = new Set([
	196,
	200,
	204
]);
const jpegSize = (bytes) => {
	let offset = 2;
	while (offset + 9 < bytes.length) {
		if (bytes[offset] !== 255) {
			offset++;
			continue;
		}
		const marker = bytes[offset + 1];
		if (marker === 255 || marker >= 208 && marker <= 217 || marker === 1) {
			offset += 2;
			continue;
		}
		const segmentLength = readUint16Be(bytes, offset + 2);
		if (segmentLength < 2) return null;
		if (marker >= 192 && marker <= 207 && !JPEG_SOF_EXCLUDED.has(marker)) {
			const height = readUint16Be(bytes, offset + 5);
			const width = readUint16Be(bytes, offset + 7);
			if (width <= 0 || height <= 0) return null;
			return {
				width,
				height
			};
		}
		offset += 2 + segmentLength;
	}
	return null;
};
/**
* Reads an image's natural pixel dimensions from its header. Supports PNG
* and JPEG — the two formats whose headers carry dimensions cheaply and
* unambiguously. Returns `null` for every other format (and for truncated
* / malformed headers), letting callers fall back rather than fail: an
* aspect-ratio-preserving placement that can't measure the image just
* stretches it as before.
*/
const readImagePixelSize = (bytes) => {
	const format = detectImageFormat(bytes);
	if (format === "png") return pngSize(bytes);
	if (format === "jpeg") return jpegSize(bytes);
	return null;
};
/**
* Returns the conventional file-extension token (no leading dot) for the
* given format. `jpeg` maps to `jpg` because that's what PowerPoint emits.
*/
const extensionForFormat = (format) => {
	switch (format) {
		case "jpeg": return "jpg";
		case "png": return "png";
		case "gif": return "gif";
		case "bmp": return "bmp";
		case "tiff": return "tiff";
		case "webp": return "webp";
		case "svg": return "svg";
	}
};
/** Returns the IANA media type for the given image format. */
const contentTypeForFormat = (format) => {
	switch (format) {
		case "png": return "image/png";
		case "jpeg": return "image/jpeg";
		case "gif": return "image/gif";
		case "bmp": return "image/bmp";
		case "tiff": return "image/tiff";
		case "webp": return "image/webp";
		case "svg": return "image/svg+xml";
	}
};
//#endregion
//#region src/internal/opc/media-format.ts
const VIDEO_CONTENT_TYPES = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	avi: "video/x-msvideo",
	wmv: "video/x-ms-wmv"
};
const AUDIO_CONTENT_TYPES = {
	mp3: "audio/mpeg",
	wav: "audio/x-wav",
	m4a: "audio/mp4",
	ogg: "audio/ogg",
	wma: "audio/x-ms-wma"
};
const contentTypeForVideoFormat = (format) => VIDEO_CONTENT_TYPES[format];
const contentTypeForAudioFormat = (format) => AUDIO_CONTENT_TYPES[format];
const hasBytesAt = (bytes, at, signature) => {
	if (bytes.length < at + signature.length) return false;
	for (let i = 0; i < signature.length; i++) if (bytes[at + i] !== signature[i]) return false;
	return true;
};
const hasAsciiAt = (bytes, at, text) => hasBytesAt(bytes, at, Array.from(text, (ch) => ch.charCodeAt(0)));
const isoBrand = (bytes) => hasAsciiAt(bytes, 4, "ftyp") && bytes.length >= 12 ? String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) : null;
const isRiff = (bytes, form) => hasAsciiAt(bytes, 0, "RIFF") && hasAsciiAt(bytes, 8, form);
const ASF_HEADER = [
	48,
	38,
	178,
	117,
	142,
	102,
	207,
	17
];
const EBML_HEADER = [
	26,
	69,
	223,
	163
];
const EBML_DOCTYPE_WINDOW = 64;
const isWebm = (bytes) => {
	if (!hasBytesAt(bytes, 0, EBML_HEADER)) return false;
	const limit = Math.min(bytes.length, EBML_DOCTYPE_WINDOW) - 4;
	for (let i = 4; i <= limit; i++) if (hasAsciiAt(bytes, i, "webm")) return true;
	return false;
};
/** Detects a video container, or `null` when no known signature matches. */
const detectVideoFormat = (bytes) => {
	const brand = isoBrand(bytes);
	if (brand !== null) {
		if (brand === "qt  ") return "mov";
		if (brand === "M4V ") return "m4v";
		return "mp4";
	}
	if (isWebm(bytes)) return "webm";
	if (isRiff(bytes, "AVI ")) return "avi";
	if (hasBytesAt(bytes, 0, ASF_HEADER)) return "wmv";
	return null;
};
/** Detects an audio container, or `null` when no known signature matches. */
const detectAudioFormat = (bytes) => {
	if (isoBrand(bytes) !== null) return "m4a";
	if (isRiff(bytes, "WAVE")) return "wav";
	if (hasAsciiAt(bytes, 0, "OggS")) return "ogg";
	if (hasBytesAt(bytes, 0, ASF_HEADER)) return "wma";
	if (hasAsciiAt(bytes, 0, "ID3")) return "mp3";
	if (bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 224) === 224) return "mp3";
	return null;
};
//#endregion
//#region src/internal/parts/package.ts
const TEXT_DECODER$1 = new TextDecoder();
const TEXT_ENCODER$3 = new TextEncoder();
const decode$2 = (b) => TEXT_DECODER$1.decode(b);
const encode$3 = (s) => TEXT_ENCODER$3.encode(s);
const parsedRels = /* @__PURE__ */ new WeakMap();
const readRels = (bytes) => {
	let rels = parsedRels.get(bytes);
	if (!rels) {
		rels = parseRels(decode$2(bytes));
		parsedRels.set(bytes, rels);
	}
	return { items: rels.items.map((item) => ({ ...item })) };
};
const CONTENT_TYPES_PART = "[Content_Types].xml";
/**
* In-memory model of an OPC package. Construct via `OpcPackage.load(bytes)`
* to read an existing `.pptx`, or via `OpcPackage.empty()` to start from
* scratch.
*/
var OpcPackage = class OpcPackage {
	/**
	* Ordered list of parts. The order is the order parts will be written to
	* the ZIP central directory on `save()`. Direct mutation is allowed for
	* callers that need to reorder, but `addPart` / `removePart` are the
	* supported entry points.
	*/
	parts;
	/** Mutable Content_Types map. Direct mutation is allowed. */
	contentTypes;
	constructor(parts, contentTypes) {
		this.parts = parts;
		this.contentTypes = contentTypes;
	}
	/**
	* Builds an empty package containing only the two default content-type
	* entries (xml, rels). No `.rels` or content parts yet — that's the caller's
	* job. PresentationML scaffolding will populate the typical PPTX skeleton.
	*/
	static empty() {
		return new OpcPackage([], emptyContentTypes());
	}
	/**
	* Loads a `.pptx` file from raw bytes. Parses `[Content_Types].xml`
	* eagerly; leaves part bodies as raw `Uint8Array`s for higher layers to
	* interpret.
	*
	* Throws if the archive is not a valid ZIP, or if `[Content_Types].xml` is
	* missing or malformed.
	*/
	static load(bytes) {
		const zip = readZip(bytes);
		let contentTypes = null;
		const parts = [];
		for (const entry of zip.entries) {
			if (entry.name === CONTENT_TYPES_PART) {
				contentTypes = parseContentTypes(decode$2(entry.data));
				continue;
			}
			if (entry.name.endsWith("/")) continue;
			const name = fromZipPath(entry.name);
			parts.push({
				name,
				contentType: "",
				data: entry.data
			});
		}
		if (contentTypes === null) throw new Error("package is missing [Content_Types].xml");
		for (const part of parts) {
			const ct = lookupContentType(contentTypes, part.name);
			if (ct === null) throw new Error(`part "${part.name}" has no content type registered in [Content_Types].xml`);
			part.contentType = ct;
		}
		return new OpcPackage(parts, contentTypes);
	}
	/** Serialize the package to a `.pptx` byte stream. */
	save() {
		const entries = [];
		entries.push({
			name: CONTENT_TYPES_PART,
			data: encode$3(serializeContentTypes(this.contentTypes))
		});
		for (const part of this.parts) entries.push({
			name: toZipPath(part.name),
			data: part.data
		});
		return writeZip(entries);
	}
	/**
	* Looks up a part by name (case-insensitive per OPC §9.1.1.7).
	*/
	getPart(name) {
		for (const p of this.parts) if (partNamesEqual(p.name, name)) return p;
		return null;
	}
	/**
	* Adds a new part. Throws if a part with the same name (case-insensitive)
	* already exists. The caller is responsible for ensuring the content type
	* is resolvable — either by extension default or by a registered override.
	*/
	addPart(name, contentType, data) {
		if (this.getPart(name) !== null) throw new Error(`part "${name}" already exists`);
		const part = {
			name,
			contentType,
			data
		};
		this.parts.push(part);
		if (lookupContentType(this.contentTypes, name) !== contentType) this.contentTypes.overrides.push({
			partName: name,
			contentType
		});
		return part;
	}
	/**
	* Removes a part by name. Returns true if a part was removed; false if no
	* part with that name was present. Also drops any matching `Override`
	* entry from Content_Types; defaults are left untouched.
	*/
	removePart(name) {
		let removed = false;
		for (let i = this.parts.length - 1; i >= 0; i--) {
			const p = this.parts[i];
			if (p && partNamesEqual(p.name, name)) {
				this.parts.splice(i, 1);
				removed = true;
			}
		}
		if (removed) this.contentTypes.overrides = this.contentTypes.overrides.filter((o) => !partNamesEqual(o.partName, name));
		return removed;
	}
	/**
	* Reads (or parses, lazily) the relationships for the given part. Returns
	* `null` if the part has no sibling `.rels` part — this is normal for
	* content parts with no outgoing relationships.
	*
	* The returned `Relationships` is a fresh snapshot. Mutate it as needed,
	* then call `setRels(forPart, rels)` to persist the change back into the
	* package.
	*/
	getRels(forPart) {
		const relsName = relsPartNameFor(forPart);
		const part = this.getPart(relsName);
		if (part === null) return null;
		return readRels(part.data);
	}
	/**
	* Writes relationships for the given part. Creates the sibling `.rels`
	* part if it didn't exist; replaces its bytes if it did. The relationships
	* part is given the standard relationships content type via the `rels`
	* extension default.
	*/
	setRels(forPart, rels) {
		const relsName = relsPartNameFor(forPart);
		const bytes = encode$3(serializeRels(rels));
		const existing = this.getPart(relsName);
		if (existing !== null) {
			existing.data = bytes;
			return;
		}
		this.addPart(relsName, "application/vnd.openxmlformats-package.relationships+xml", bytes);
	}
	/**
	* Convenience: read the package-root relationships (`/_rels/.rels`).
	* These point at the top-level parts — typically the presentation.xml,
	* core properties, and extended properties.
	*/
	rootRels() {
		const part = this.getPart(partName("/_rels/.rels"));
		if (part === null) return null;
		return readRels(part.data);
	}
	/** Convenience: write package-root relationships. */
	setRootRels(rels) {
		const name = partName("/_rels/.rels");
		const bytes = encode$3(serializeRels(rels));
		const existing = this.getPart(name);
		if (existing !== null) {
			existing.data = bytes;
			return;
		}
		this.addPart(name, "application/vnd.openxmlformats-package.relationships+xml", bytes);
	}
};
//#endregion
//#region src/internal/parts/blank-deck.ts
const SLIDE_SIZE = {
	"16:9": {
		cx: 12192e3,
		cy: 6858e3,
		type: "screen16x9"
	},
	"4:3": {
		cx: 9144e3,
		cy: 6858e3,
		type: "screen4x3"
	}
};
const RELS_CONTENT_TYPE = "application/vnd.openxmlformats-package.relationships+xml";
const PRESENTATION_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const PRES_PROPS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml";
const VIEW_PROPS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml";
const SLIDE_MASTER_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml";
const SLIDE_LAYOUT_CONTENT_TYPE$1 = "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
const THEME_CONTENT_TYPE$1 = "application/vnd.openxmlformats-officedocument.theme+xml";
const TABLE_STYLES_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml";
const CORE_PROPS_CONTENT_TYPE$1 = "application/vnd.openxmlformats-package.core-properties+xml";
const EXTENDED_PROPS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.extended-properties+xml";
const XML_DECL = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n";
const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const RT_PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";
const THEME_XML = `${XML_DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="游ゴシック Light"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="等线 Light"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Times New Roman"/><a:font script="Hebr" typeface="Times New Roman"/><a:font script="Thai" typeface="Angsana New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="MoolBoran"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Times New Roman"/><a:font script="Uigh" typeface="Microsoft Uighur"/><a:font script="Geor" typeface="Sylfaen"/><a:font script="Armn" typeface="Arial"/><a:font script="Bugi" typeface="Leelawadee UI"/><a:font script="Bopo" typeface="Microsoft JhengHei"/><a:font script="Java" typeface="Javanese Text"/><a:font script="Lisu" typeface="Segoe UI"/><a:font script="Mymr" typeface="Myanmar Text"/><a:font script="Nkoo" typeface="Ebrima"/><a:font script="Olck" typeface="Nirmala UI"/><a:font script="Osma" typeface="Ebrima"/><a:font script="Phag" typeface="Phagspa"/><a:font script="Syrn" typeface="Estrangelo Edessa"/><a:font script="Syrj" typeface="Estrangelo Edessa"/><a:font script="Syre" typeface="Estrangelo Edessa"/><a:font script="Sora" typeface="Nirmala UI"/><a:font script="Tale" typeface="Microsoft Tai Le"/><a:font script="Talu" typeface="Microsoft New Tai Lue"/><a:font script="Tfng" typeface="Ebrima"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="游ゴシック"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="等线"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Arial"/><a:font script="Hebr" typeface="Arial"/><a:font script="Thai" typeface="Cordia New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="DaunPenh"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Arial"/><a:font script="Uigh" typeface="Microsoft Uighur"/><a:font script="Geor" typeface="Sylfaen"/><a:font script="Armn" typeface="Arial"/><a:font script="Bugi" typeface="Leelawadee UI"/><a:font script="Bopo" typeface="Microsoft JhengHei"/><a:font script="Java" typeface="Javanese Text"/><a:font script="Lisu" typeface="Segoe UI"/><a:font script="Mymr" typeface="Myanmar Text"/><a:font script="Nkoo" typeface="Ebrima"/><a:font script="Olck" typeface="Nirmala UI"/><a:font script="Osma" typeface="Ebrima"/><a:font script="Phag" typeface="Phagspa"/><a:font script="Syrn" typeface="Estrangelo Edessa"/><a:font script="Syrj" typeface="Estrangelo Edessa"/><a:font script="Syre" typeface="Estrangelo Edessa"/><a:font script="Sora" typeface="Nirmala UI"/><a:font script="Tale" typeface="Microsoft Tai Le"/><a:font script="Talu" typeface="Microsoft New Tai Lue"/><a:font script="Tfng" typeface="Ebrima"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="35000"><a:schemeClr val="phClr"><a:tint val="37000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="15000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="100000"/><a:shade val="100000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="50000"/><a:shade val="100000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/><a:satMod val="105000"/></a:schemeClr></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d><a:camera prst="orthographicFront"><a:rot lat="0" lon="0" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"><a:rot lat="0" lon="0" rev="1200000"/></a:lightRig></a:scene3d><a:sp3d><a:bevelT w="63500" h="25400"/></a:sp3d></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="40000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="40000"><a:schemeClr val="phClr"><a:tint val="45000"/><a:shade val="99000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="20000"/><a:satMod val="255000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="-80000" r="50000" b="180000"/></a:path></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="80000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="30000"/><a:satMod val="200000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
const SLIDE_MASTER_XML = `${XML_DECL}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" smtClean="0"/><a:t>Click to edit Master title style</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US" smtClean="0"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/><p:sldLayoutId id="2147483651" r:id="rId3"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="3200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="742950" indent="-285750" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="–"/><a:defRPr sz="2800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl2pPr><a:lvl3pPr marL="1143000" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl3pPr><a:lvl4pPr marL="1600200" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="–"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl4pPr><a:lvl5pPr marL="2057400" indent="-228600" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="»"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl5pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const LAYOUT_BLANK_XML = `${XML_DECL}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const LAYOUT_TITLE_XML = `${XML_DECL}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title" preserve="1"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="2130425"/><a:ext cx="7772400" cy="1470025"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" smtClean="0"/><a:t>Click to edit Master title style</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1371600" y="3886200"/><a:ext cx="6400800" cy="1752600"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" smtClean="0"/><a:t>Click to edit Master subtitle style</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const LAYOUT_OBJ_XML = `${XML_DECL}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" smtClean="0"/><a:t>Click to edit Master title style</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US" smtClean="0"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const buildPresentationXml = (size) => `${XML_DECL}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldSz cx="${size.cx}" cy="${size.cy}" type="${size.type}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
const PRES_PROPS_XML = `${XML_DECL}<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;
const VIEW_PROPS_XML = `${XML_DECL}<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;
const TABLE_STYLES_XML = `${XML_DECL}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
const CORE_PROPS_XML = `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title></dc:title><dc:creator>@office-kit/pptx</dc:creator><cp:lastModifiedBy>@office-kit/pptx</cp:lastModifiedBy></cp:coreProperties>`;
const EXTENDED_PROPS_XML = `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>@office-kit/pptx</Application></Properties>`;
const ROOT_RELS_XML = `${XML_DECL}<Relationships xmlns="${RT_PACKAGE}"><Relationship Id="rId1" Type="${RT}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="${RT_PACKAGE}/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${RT}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const PRES_RELS_XML = `${XML_DECL}<Relationships xmlns="${RT_PACKAGE}"><Relationship Id="rId1" Type="${RT}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${RT}/theme" Target="theme/theme1.xml"/><Relationship Id="rId3" Type="${RT}/presProps" Target="presProps.xml"/><Relationship Id="rId4" Type="${RT}/viewProps" Target="viewProps.xml"/><Relationship Id="rId5" Type="${RT}/tableStyles" Target="tableStyles.xml"/></Relationships>`;
const MASTER_RELS_XML = `${XML_DECL}<Relationships xmlns="${RT_PACKAGE}"><Relationship Id="rId1" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/><Relationship Id="rId3" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout3.xml"/><Relationship Id="rId4" Type="${RT}/theme" Target="../theme/theme1.xml"/></Relationships>`;
const LAYOUT_RELS_XML = `${XML_DECL}<Relationships xmlns="${RT_PACKAGE}"><Relationship Id="rId1" Type="${RT}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
const TEXT_ENCODER$2 = new TextEncoder();
const encode$2 = (s) => TEXT_ENCODER$2.encode(s);
/**
* Builds an OPC package for an immediately-authorable blank deck: one
* slide master, the Office theme, three layouts (Blank / Title Slide /
* Title and Content), and the chosen slide size. The deck has no slides
* yet — call `addSlide({ layout })` (or `addBlankSlide` / `addTitleSlide`
* / `addContentSlide`) to add one.
*/
const buildBlankDeck = (aspect) => {
	const pkg = OpcPackage.empty();
	const size = SLIDE_SIZE[aspect];
	const add = (name, contentType, xml) => {
		pkg.addPart(partName(name), contentType, encode$2(xml));
	};
	const addRels = (name, xml) => {
		pkg.addPart(partName(name), RELS_CONTENT_TYPE, encode$2(xml));
	};
	add("/ppt/presentation.xml", PRESENTATION_CONTENT_TYPE, buildPresentationXml(size));
	add("/ppt/presProps.xml", PRES_PROPS_CONTENT_TYPE, PRES_PROPS_XML);
	add("/ppt/viewProps.xml", VIEW_PROPS_CONTENT_TYPE, VIEW_PROPS_XML);
	add("/ppt/theme/theme1.xml", THEME_CONTENT_TYPE$1, THEME_XML);
	add("/ppt/tableStyles.xml", TABLE_STYLES_CONTENT_TYPE, TABLE_STYLES_XML);
	add("/ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER_CONTENT_TYPE, SLIDE_MASTER_XML);
	add("/ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT_CONTENT_TYPE$1, LAYOUT_BLANK_XML);
	add("/ppt/slideLayouts/slideLayout2.xml", SLIDE_LAYOUT_CONTENT_TYPE$1, LAYOUT_TITLE_XML);
	add("/ppt/slideLayouts/slideLayout3.xml", SLIDE_LAYOUT_CONTENT_TYPE$1, LAYOUT_OBJ_XML);
	add("/docProps/core.xml", CORE_PROPS_CONTENT_TYPE$1, CORE_PROPS_XML);
	add("/docProps/app.xml", EXTENDED_PROPS_CONTENT_TYPE, EXTENDED_PROPS_XML);
	addRels("/_rels/.rels", ROOT_RELS_XML);
	addRels("/ppt/_rels/presentation.xml.rels", PRES_RELS_XML);
	addRels("/ppt/slideMasters/_rels/slideMaster1.xml.rels", MASTER_RELS_XML);
	addRels("/ppt/slideLayouts/_rels/slideLayout1.xml.rels", LAYOUT_RELS_XML);
	addRels("/ppt/slideLayouts/_rels/slideLayout2.xml.rels", LAYOUT_RELS_XML);
	addRels("/ppt/slideLayouts/_rels/slideLayout3.xml.rels", LAYOUT_RELS_XML);
	return pkg;
};
//#endregion
//#region src/api/_internal-symbols.ts
const INTERNAL_PACKAGE = Symbol.for("@office-kit/pptx.package");
const SLIDE_PART_NAME = Symbol.for("@office-kit/pptx.slide.partName");
const SLIDE_DOCUMENT = Symbol.for("@office-kit/pptx.slide.document");
const SLIDE_PART = Symbol.for("@office-kit/pptx.slide.part");
const SLIDE_SHAPES = Symbol.for("@office-kit/pptx.slide.shapes");
const SHAPE_SLIDE = Symbol.for("@office-kit/pptx.shape.slide");
const SHAPE_ELEMENT = Symbol.for("@office-kit/pptx.shape.element");
const SHAPE_SNAPSHOT = Symbol.for("@office-kit/pptx.shape.snapshot");
const LAYOUT_PART_NAME = Symbol.for("@office-kit/pptx.layout.partName");
const LAYOUT_PART = Symbol.for("@office-kit/pptx.layout.part");
const COMMENT_SLIDE = Symbol.for("@office-kit/pptx.comment.slide");
const COMMENT_SNAPSHOT = Symbol.for("@office-kit/pptx.comment.snapshot");
const CELL_TABLE = Symbol.for("@office-kit/pptx.cell.table");
const CELL_ELEMENT = Symbol.for("@office-kit/pptx.cell.element");
const CELL_ROW = Symbol.for("@office-kit/pptx.cell.row");
const CELL_COL = Symbol.for("@office-kit/pptx.cell.col");
//#endregion
//#region src/api/fn/package-io.ts
const normalize = async (input) => {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (typeof Blob !== "undefined" && input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
	throw new TypeError("loadPresentation: expected Uint8Array | ArrayBuffer | Blob");
};
/**
* Loads an existing `.pptx` and returns a `PresentationData` value.
*/
const loadPresentation = async (input) => {
	const bytes = await normalize(input);
	const pkg = OpcPackage.load(bytes);
	return {
		[INTERNAL_PACKAGE]: pkg,
		_slidesCache: null
	};
};
/**
* Creates a fresh, immediately-authorable `PresentationData`.
*
* The returned deck carries a slide master, the Office theme, and three
* slide layouts — `'Blank'`, `'Title Slide'`, and `'Title and Content'` —
* but no slides yet. Add one with {@link addSlide} (or the
* `addBlankSlide` / `addTitleSlide` / `addContentSlide` helpers), then
* `savePresentation` to emit a `.pptx` that opens cleanly in PowerPoint,
* Keynote, Google Slides, and LibreOffice.
*
* @param options.size Slide aspect ratio. `'16:9'` (12192000×6858000 EMU,
*   PowerPoint's modern default) or `'4:3'` (9144000×6858000). Defaults to
*   `'16:9'`.
*/
const createPresentation = (options = {}) => {
	const pkg = buildBlankDeck(options.size ?? "16:9");
	return {
		[INTERNAL_PACKAGE]: pkg,
		_slidesCache: null
	};
};
/**
* Serializes a presentation back to PPTX bytes.
*/
const savePresentation = (pres) => {
	return Promise.resolve(pres[INTERNAL_PACKAGE].save());
};
//#endregion
//#region src/internal/presentationml/relationship-types.ts
const OFFICE_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";
const MS_2007 = "http://schemas.microsoft.com/office/2007/relationships";
const MS_2015 = "http://schemas.microsoft.com/office/2015/relationships";
const REL_TYPES = {
	officeDocument: `${OFFICE_DOC}/officeDocument`,
	coreProperties: `${PACKAGE}/metadata/core-properties`,
	extendedProperties: `${OFFICE_DOC}/extended-properties`,
	customProperties: `${OFFICE_DOC}/custom-properties`,
	slideMaster: `${OFFICE_DOC}/slideMaster`,
	notesMaster: `${OFFICE_DOC}/notesMaster`,
	handoutMaster: `${OFFICE_DOC}/handoutMaster`,
	slide: `${OFFICE_DOC}/slide`,
	presProps: `${OFFICE_DOC}/presProps`,
	viewProps: `${OFFICE_DOC}/viewProps`,
	theme: `${OFFICE_DOC}/theme`,
	tableStyles: `${OFFICE_DOC}/tableStyles`,
	customXmlProps: `${OFFICE_DOC}/customXmlProps`,
	customXml: `${OFFICE_DOC}/customXml`,
	thumbnail: `${PACKAGE}/metadata/thumbnail`,
	slideLayout: `${OFFICE_DOC}/slideLayout`,
	notesSlide: `${OFFICE_DOC}/notesSlide`,
	hyperlink: `${OFFICE_DOC}/hyperlink`,
	image: `${OFFICE_DOC}/image`,
	chart: `${OFFICE_DOC}/chart`,
	oleObject: `${OFFICE_DOC}/oleObject`,
	package: `${OFFICE_DOC}/package`,
	diagramData: `${OFFICE_DOC}/diagramData`,
	diagramLayout: `${OFFICE_DOC}/diagramLayout`,
	diagramQuickStyle: `${OFFICE_DOC}/diagramQuickStyle`,
	diagramColors: `${OFFICE_DOC}/diagramColors`,
	media: `${MS_2007}/media`,
	video: `${OFFICE_DOC}/video`,
	audio: `${OFFICE_DOC}/audio`,
	font: `${OFFICE_DOC}/font`,
	authors: `${MS_2015}/authors`,
	modernComment: `${MS_2015}/comments`,
	comments: `${OFFICE_DOC}/comments`,
	commentAuthors: `${OFFICE_DOC}/commentAuthors`
};
//#endregion
//#region src/internal/presentationml/presentation-part.ts
const NAME_PRESENTATION$1 = qname("p", "presentation", NS.pml);
const NAME_SLD_MASTER_ID_LST$1 = qname("p", "sldMasterIdLst", NS.pml);
const NAME_SLD_MASTER_ID = qname("p", "sldMasterId", NS.pml);
const NAME_SLD_ID_LST$2 = qname("p", "sldIdLst", NS.pml);
const NAME_SLD_ID$2 = qname("p", "sldId", NS.pml);
const NAME_NOTES_MASTER_ID_LST = qname("p", "notesMasterIdLst", NS.pml);
const NAME_NOTES_MASTER_ID = qname("p", "notesMasterId", NS.pml);
const NAME_SLD_SZ = qname("p", "sldSz", NS.pml);
const NAME_NOTES_SZ = qname("p", "notesSz", NS.pml);
const ATTR_ID$15 = qname("", "id", "");
const ATTR_R_ID$4 = qname("r", "id", NS.officeDocRels);
const ATTR_CX$9 = qname("", "cx", "");
const ATTR_CY$9 = qname("", "cy", "");
const ATTR_TYPE$6 = qname("", "type", "");
const requireRId = (element, context) => {
	const value = getAttrValue(element, ATTR_R_ID$4);
	if (value === null) throw new Error(`${context}: missing r:id attribute`);
	return value;
};
const readSize$1 = (parent, name) => {
	const el = firstChildElement(parent, name);
	if (el === null) return null;
	const cxRaw = getAttrValue(el, ATTR_CX$9);
	const cyRaw = getAttrValue(el, ATTR_CY$9);
	if (cxRaw === null || cyRaw === null) throw new Error(`<${name.localName}>: missing cx/cy attribute`);
	const type = getAttrValue(el, ATTR_TYPE$6);
	return {
		cx: Number.parseInt(cxRaw, 10),
		cy: Number.parseInt(cyRaw, 10),
		...type !== null ? { type } : {}
	};
};
/**
* Parses a `p:presentation` root element into the typed view above. Throws
* if the root is not `p:presentation` in the PresentationML namespace.
*/
const readPresentationPart = (root) => {
	if (root.name.namespaceURI !== NAME_PRESENTATION$1.namespaceURI || root.name.localName !== "presentation") throw new Error(`expected <p:presentation>, got <${root.name.prefix}:${root.name.localName}>`);
	const sldMasters = [];
	const sldMasterLst = firstChildElement(root, NAME_SLD_MASTER_ID_LST$1);
	if (sldMasterLst !== null) for (const item of allChildElements(sldMasterLst, NAME_SLD_MASTER_ID)) {
		const idRaw = getAttrValue(item, ATTR_ID$15);
		if (idRaw === null) throw new Error("<p:sldMasterId>: missing id attribute");
		sldMasters.push({
			id: Number.parseInt(idRaw, 10),
			rId: requireRId(item, "<p:sldMasterId>")
		});
	}
	const slides = [];
	const sldLst = firstChildElement(root, NAME_SLD_ID_LST$2);
	if (sldLst !== null) for (const item of allChildElements(sldLst, NAME_SLD_ID$2)) {
		const idRaw = getAttrValue(item, ATTR_ID$15);
		if (idRaw === null) throw new Error("<p:sldId>: missing id attribute");
		slides.push({
			id: Number.parseInt(idRaw, 10),
			rId: requireRId(item, "<p:sldId>")
		});
	}
	let notesMaster = null;
	const notesMasterLst = firstChildElement(root, NAME_NOTES_MASTER_ID_LST);
	if (notesMasterLst !== null) {
		const item = firstChildElement(notesMasterLst, NAME_NOTES_MASTER_ID);
		if (item !== null) notesMaster = { rId: requireRId(item, "<p:notesMasterId>") };
	}
	return {
		slideMasters: sldMasters,
		slides,
		notesMaster,
		slideSize: readSize$1(root, NAME_SLD_SZ),
		notesSize: readSize$1(root, NAME_NOTES_SZ)
	};
};
//#endregion
//#region src/internal/drawingml/text-body.ts
const NAME_P$6 = qname("a", "p", NS.dml);
NS.dml;
const NAME_T$6 = qname("a", "t", NS.dml);
/**
* Returns the visible text of a single paragraph (`a:p`). Concatenates all
* `a:t` runs and field results in document order; treats `a:br` as a
* newline within the paragraph.
*/
const paragraphText = (paragraph) => {
	let out = "";
	for (const child of paragraph.children) {
		if (child.kind !== "element") continue;
		if (child.name.namespaceURI !== NS.dml) continue;
		switch (child.name.localName) {
			case "r":
			case "fld": {
				const t = allChildElements(child, NAME_T$6)[0];
				if (t) out += textContent(t);
				break;
			}
			case "br":
				out += "\n";
				break;
			default: break;
		}
	}
	return out;
};
/**
* Returns the visible text of an `a:txBody` element, joining each
* paragraph with `\n`. Empty paragraphs become empty lines, so a body of
* three paragraphs always produces two newlines.
*/
const textBodyText = (txBody) => {
	const parts = [];
	for (const p of allChildElements(txBody, NAME_P$6)) parts.push(paragraphText(p));
	return parts.join("\n");
};
//#endregion
//#region src/internal/bounds.ts
const RANGES = {
	coordinate: [-27273042329600, 27273042316900],
	positiveCoordinate: [0, 27273042316900],
	coordinate32: [-2147483648, 2147483647],
	positiveCoordinate32: [0, 2147483647],
	lineWidth: [0, 20116800],
	angle: [-2147483648, 2147483647],
	fontSize: [100, 4e5],
	textPoint: [-4e5, 4e5],
	textSpacingPoint: [0, 158400],
	unsignedInt: [0, 4294967295],
	columnCount: [1, 16],
	overlap: [-100, 100],
	gapAmount: [0, 500],
	holeSize: [1, 90],
	firstSliceAng: [0, 360],
	rotX: [-90, 90],
	rotY: [0, 360],
	perspective: [0, 240],
	depthPercent: [20, 2e3],
	heightPercent: [5, 500],
	secondPieSize: [5, 200],
	bubbleScale: [0, 300],
	percent100000: [0, 1e5]
};
const boundedInt = (value, key, field) => {
	if (!Number.isFinite(value)) throw new RangeError(`${field}: expected a finite number, got ${value}`);
	const n = Math.round(value);
	const [min, max] = RANGES[key];
	if (n < min || n > max) throw new RangeError(`${field}: ${value} is out of range for ${key} (${min}..${max})`);
	return n;
};
/** EMU position coordinate (`<a:off>` x/y) — ST_Coordinate. */
const emuCoordinate = (v, field) => boundedInt(v, "coordinate", field);
/** EMU extent (`<a:ext>` cx/cy, column/table widths, row heights) — ST_PositiveCoordinate. */
const emuExtent = (v, field) => boundedInt(v, "positiveCoordinate", field);
/** 32-bit EMU (text-body insets, cell margins) — ST_Coordinate32. */
const emuCoordinate32 = (v, field) => boundedInt(v, "coordinate32", field);
/** Non-negative 32-bit EMU (column gap) — ST_PositiveCoordinate32. */
const emuPositiveCoordinate32 = (v, field) => boundedInt(v, "positiveCoordinate32", field);
/** Line width in EMU — ST_LineWidth. */
const lineWidthEmu = (v, field) => boundedInt(v, "lineWidth", field);
/** Angle in 1/60000 degree — ST_Angle. */
const angle60000 = (v, field) => boundedInt(v, "angle", field);
/** Font size in 1/100 pt — ST_TextFontSize. */
const fontSizeHundredthPt = (v, field) => boundedInt(v, "fontSize", field);
/** Character spacing in 1/100 pt — ST_TextPoint. */
const textPointSpacing = (v, field) => boundedInt(v, "textPoint", field);
/** Auto-advance / timing duration in ms — xsd:unsignedInt. */
const unsignedIntMs = (v, field) => boundedInt(v, "unsignedInt", field);
/** Text column count — ST_TextColumnCount (1..16). */
const textColumnCount = (v, field) => boundedInt(v, "columnCount", field);
/** Bar/column series overlap percent — ST_OverlapByte (-100..100). */
const overlapPercent = (v, field) => boundedInt(v, "overlap", field);
/** Bar/column gap width percent — ST_GapAmount (0..500). */
const gapAmountPercent = (v, field) => boundedInt(v, "gapAmount", field);
/** Doughnut hole size percent — ST_HoleSizeUByte (1..90). */
const holeSizePercent = (v, field) => boundedInt(v, "holeSize", field);
/** Pie/doughnut first-slice angle in degrees — ST_FirstSliceAng (0..360). */
const firstSliceAngle = (v, field) => boundedInt(v, "firstSliceAng", field);
const GUID_RE = /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;
const normalizeGuid = (value, field) => {
	if (!GUID_RE.test(value)) throw new RangeError(`${field}: ${JSON.stringify(value)} is not a GUID of the form {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`);
	return value.toUpperCase();
};
const oneOf = (value, allowed, field) => {
	if (!allowed.includes(value)) throw new RangeError(`${field}: ${JSON.stringify(value)} is not one of: ${allowed.join(", ")}`);
	return value;
};
//#endregion
//#region src/internal/enum-values.ts
const SHAPE_PRESETS = [
	"line",
	"lineInv",
	"triangle",
	"rtTriangle",
	"rect",
	"diamond",
	"parallelogram",
	"trapezoid",
	"nonIsoscelesTrapezoid",
	"pentagon",
	"hexagon",
	"heptagon",
	"octagon",
	"decagon",
	"dodecagon",
	"star4",
	"star5",
	"star6",
	"star7",
	"star8",
	"star10",
	"star12",
	"star16",
	"star24",
	"star32",
	"roundRect",
	"round1Rect",
	"round2SameRect",
	"round2DiagRect",
	"snipRoundRect",
	"snip1Rect",
	"snip2SameRect",
	"snip2DiagRect",
	"plaque",
	"ellipse",
	"teardrop",
	"homePlate",
	"chevron",
	"pieWedge",
	"pie",
	"blockArc",
	"donut",
	"noSmoking",
	"rightArrow",
	"leftArrow",
	"upArrow",
	"downArrow",
	"stripedRightArrow",
	"notchedRightArrow",
	"bentUpArrow",
	"leftRightArrow",
	"upDownArrow",
	"leftUpArrow",
	"leftRightUpArrow",
	"quadArrow",
	"leftArrowCallout",
	"rightArrowCallout",
	"upArrowCallout",
	"downArrowCallout",
	"leftRightArrowCallout",
	"upDownArrowCallout",
	"quadArrowCallout",
	"bentArrow",
	"uturnArrow",
	"circularArrow",
	"leftCircularArrow",
	"leftRightCircularArrow",
	"curvedRightArrow",
	"curvedLeftArrow",
	"curvedUpArrow",
	"curvedDownArrow",
	"swooshArrow",
	"cube",
	"can",
	"lightningBolt",
	"heart",
	"sun",
	"moon",
	"smileyFace",
	"irregularSeal1",
	"irregularSeal2",
	"foldedCorner",
	"bevel",
	"frame",
	"halfFrame",
	"corner",
	"diagStripe",
	"chord",
	"arc",
	"leftBracket",
	"rightBracket",
	"leftBrace",
	"rightBrace",
	"bracketPair",
	"bracePair",
	"straightConnector1",
	"bentConnector2",
	"bentConnector3",
	"bentConnector4",
	"bentConnector5",
	"curvedConnector2",
	"curvedConnector3",
	"curvedConnector4",
	"curvedConnector5",
	"callout1",
	"callout2",
	"callout3",
	"accentCallout1",
	"accentCallout2",
	"accentCallout3",
	"borderCallout1",
	"borderCallout2",
	"borderCallout3",
	"accentBorderCallout1",
	"accentBorderCallout2",
	"accentBorderCallout3",
	"wedgeRectCallout",
	"wedgeRoundRectCallout",
	"wedgeEllipseCallout",
	"cloudCallout",
	"cloud",
	"ribbon",
	"ribbon2",
	"ellipseRibbon",
	"ellipseRibbon2",
	"leftRightRibbon",
	"verticalScroll",
	"horizontalScroll",
	"wave",
	"doubleWave",
	"plus",
	"flowChartProcess",
	"flowChartDecision",
	"flowChartInputOutput",
	"flowChartPredefinedProcess",
	"flowChartInternalStorage",
	"flowChartDocument",
	"flowChartMultidocument",
	"flowChartTerminator",
	"flowChartPreparation",
	"flowChartManualInput",
	"flowChartManualOperation",
	"flowChartConnector",
	"flowChartPunchedCard",
	"flowChartPunchedTape",
	"flowChartSummingJunction",
	"flowChartOr",
	"flowChartCollate",
	"flowChartSort",
	"flowChartExtract",
	"flowChartMerge",
	"flowChartOfflineStorage",
	"flowChartOnlineStorage",
	"flowChartMagneticTape",
	"flowChartMagneticDisk",
	"flowChartMagneticDrum",
	"flowChartDisplay",
	"flowChartDelay",
	"flowChartAlternateProcess",
	"flowChartOffpageConnector",
	"actionButtonBlank",
	"actionButtonHome",
	"actionButtonHelp",
	"actionButtonInformation",
	"actionButtonForwardNext",
	"actionButtonBackPrevious",
	"actionButtonEnd",
	"actionButtonBeginning",
	"actionButtonReturn",
	"actionButtonDocument",
	"actionButtonSound",
	"actionButtonMovie",
	"gear6",
	"gear9",
	"funnel",
	"mathPlus",
	"mathMinus",
	"mathMultiply",
	"mathDivide",
	"mathEqual",
	"mathNotEqual",
	"cornerTabs",
	"squareTabs",
	"plaqueTabs",
	"chartX",
	"chartStar",
	"chartPlus"
];
const LINE_DASHES = [
	"solid",
	"dot",
	"dash",
	"lgDash",
	"dashDot",
	"lgDashDot",
	"lgDashDotDot",
	"sysDash",
	"sysDot",
	"sysDashDot",
	"sysDashDotDot"
];
const TEXT_DIRECTIONS = [
	"horz",
	"vert",
	"vert270",
	"wordArtVert",
	"eaVert",
	"mongolianVert",
	"wordArtVertRtl"
];
const AUTO_NUMBER_SCHEMES = [
	"alphaLcParenBoth",
	"alphaUcParenBoth",
	"alphaLcParenR",
	"alphaUcParenR",
	"alphaLcPeriod",
	"alphaUcPeriod",
	"arabicParenBoth",
	"arabicParenR",
	"arabicPeriod",
	"arabicPlain",
	"romanLcParenBoth",
	"romanUcParenBoth",
	"romanLcParenR",
	"romanUcParenR",
	"romanLcPeriod",
	"romanUcPeriod",
	"circleNumDbPlain",
	"circleNumWdBlackPlain",
	"circleNumWdWhitePlain",
	"arabicDbPeriod",
	"arabicDbPlain",
	"ea1ChsPeriod",
	"ea1ChsPlain",
	"ea1ChtPeriod",
	"ea1ChtPlain",
	"ea1JpnChsDbPeriod",
	"ea1JpnKorPlain",
	"ea1JpnKorPeriod",
	"arabic1Minus",
	"arabic2Minus",
	"hebrew2Minus",
	"thaiAlphaPeriod",
	"thaiAlphaParenR",
	"thaiAlphaParenBoth",
	"thaiNumPeriod",
	"thaiNumParenR",
	"thaiNumParenBoth",
	"hindiAlphaPeriod",
	"hindiNumPeriod",
	"hindiNumParenR",
	"hindiAlpha1Period"
];
const UNDERLINES = [
	"none",
	"words",
	"sng",
	"dbl",
	"heavy",
	"dotted",
	"dottedHeavy",
	"dash",
	"dashHeavy",
	"dashLong",
	"dashLongHeavy",
	"dotDash",
	"dotDashHeavy",
	"dotDotDash",
	"dotDotDashHeavy",
	"wavy",
	"wavyHeavy",
	"wavyDbl"
];
const STRIKES = [
	"noStrike",
	"sngStrike",
	"dblStrike"
];
const SLIDE_SIZE_TYPES = [
	"screen4x3",
	"letter",
	"A4",
	"35mm",
	"overhead",
	"banner",
	"custom",
	"ledger",
	"A3",
	"B4ISO",
	"B5ISO",
	"B4JIS",
	"B5JIS",
	"hagakiCard",
	"screen16x9",
	"screen16x10"
];
const TEXT_ANCHORS = {
	top: "t",
	center: "ctr",
	bottom: "b"
};
//#endregion
//#region src/internal/drawingml/color.ts
const NAME_SRGB_CLR$4 = qname("a", "srgbClr", NS.dml);
const NAME_SCHEME_CLR$2 = qname("a", "schemeClr", NS.dml);
const ATTR_VAL$9 = qname("", "val", "");
const SCHEME_TOKENS = new Set([
	"bg1",
	"tx1",
	"bg2",
	"tx2",
	"accent1",
	"accent2",
	"accent3",
	"accent4",
	"accent5",
	"accent6",
	"hlink",
	"folHlink",
	"phClr",
	"lt1",
	"dk1",
	"lt2",
	"dk2"
]);
/**
* Normalizes an sRGB hex string to the canonical uppercase 6-digit form
* (no `#`), or returns `null` if it isn't a 3- or 6-digit hex. The CSS-style
* 3-digit shorthand (`#f00` → `FF0000`) is accepted because LLM authors reach
* for it constantly; 4-/8-digit (alpha) forms are rejected rather than
* silently dropping the alpha channel, which OOXML encodes separately.
*/
const normalizeSrgbHex = (value) => {
	const hex = value.startsWith("#") ? value.slice(1) : value;
	if (/^[0-9A-Fa-f]{6}$/.test(hex)) return hex.toUpperCase();
	if (/^[0-9A-Fa-f]{3}$/.test(hex)) return Array.from(hex, (ch) => ch + ch).join("").toUpperCase();
	return null;
};
/**
* Parses a user-supplied color string. Returns null on unrecognized input
* so callers can decide whether to throw with a specific message.
*
* Scheme tokens are accepted both bare (`accent1`) and with the explicit
* `scheme:` prefix (`scheme:accent1`). The prefixed form is what the getters
* (`getShapeFillColor`, `getSlideBackground`, …) return, so accepting it here
* is what makes `setX(getX(...))` round-trip instead of throwing.
*/
const parseColor = (value) => {
	const token = value.startsWith("scheme:") ? value.slice(7) : value;
	if (SCHEME_TOKENS.has(token)) return {
		kind: "scheme",
		token
	};
	if (value !== token) return null;
	const hex = normalizeSrgbHex(value);
	return hex === null ? null : {
		kind: "srgb",
		hex
	};
};
/**
* Parses an sRGB hex color (`#RRGGBB`, `RRGGBB`, or the 3-digit `#RGB`
* shorthand), returning the normalized uppercase 6-digit hex (no `#`).
* Returns `null` for anything else — including scheme tokens, which sRGB-only
* contexts (e.g. chart series fills) must reject rather than silently
* emit as an invalid `<a:srgbClr val="accent1"/>`.
*/
const parseSrgbHex = (value) => normalizeSrgbHex(value);
/**
* Returns the `<a:srgbClr>` or `<a:schemeClr>` element for `value`.
* Throws on unrecognized colors.
*/
const buildColorElement = (value) => {
	const parsed = parseColor(value);
	if (parsed === null) throw new Error(`unrecognized color: ${value}`);
	return parsed.kind === "srgb" ? elem(NAME_SRGB_CLR$4, { attrs: [attr(ATTR_VAL$9, parsed.hex)] }) : elem(NAME_SCHEME_CLR$2, { attrs: [attr(ATTR_VAL$9, parsed.token)] });
};
/**
* Narrows a color read back from a deck to one that can be written again,
* or `null` when it is not a color this library can emit.
*
* The readers surface `<a:schemeClr val>` verbatim, so a round-trip
* (`setX(getX(...))`) has to pass through a check somewhere; doing it here
* keeps that single `Color` assertion backed by the same parser that
* `buildColorElement` uses.
*/
const asColor = (value) => parseColor(value) === null ? null : value;
//#endregion
//#region src/internal/drawingml/text-format.ts
NS.dml;
const NAME_RPR$6 = qname("a", "rPr", NS.dml);
const NAME_LATIN = qname("a", "latin", NS.dml);
const NAME_EA = qname("a", "ea", NS.dml);
const NAME_CS = qname("a", "cs", NS.dml);
const NAME_SOLID_FILL$6 = qname("a", "solidFill", NS.dml);
const NAME_SRGB_CLR$3 = qname("a", "srgbClr", NS.dml);
const NAME_SCHEME_CLR$1 = qname("a", "schemeClr", NS.dml);
const ATTR_SZ = qname("", "sz", "");
const ATTR_B = qname("", "b", "");
const ATTR_I = qname("", "i", "");
const ATTR_U = qname("", "u", "");
const ATTR_STRIKE = qname("", "strike", "");
const ATTR_SPC = qname("", "spc", "");
const ATTR_KERN = qname("", "kern", "");
const ATTR_BASELINE = qname("", "baseline", "");
const ATTR_CAP = qname("", "cap", "");
const ATTR_TYPEFACE$3 = qname("", "typeface", "");
const ATTR_VAL$8 = qname("", "val", "");
const NAME_HIGHLIGHT = qname("a", "highlight", NS.dml);
const RPR_CHILD_RANK = {
	ln: 0,
	noFill: 1,
	solidFill: 1,
	gradFill: 1,
	blipFill: 1,
	pattFill: 1,
	grpFill: 1,
	effectLst: 2,
	effectDag: 2,
	highlight: 3,
	uLnTx: 4,
	uLn: 4,
	uFillTx: 5,
	uFill: 5,
	latin: 6,
	ea: 7,
	cs: 8,
	sym: 9,
	hlinkClick: 10,
	hlinkMouseOver: 11,
	rtl: 12,
	extLst: 13
};
const rprChildRank = (el) => el.name.namespaceURI === NS.dml ? RPR_CHILD_RANK[el.name.localName] ?? 99 : 99;
const setOrRemoveAttr = (attrs, name, value) => {
	const filtered = attrs.filter((a) => a.name.localName !== name.localName);
	if (value !== null) filtered.push(attr(name, value));
	return filtered;
};
const setSolidFill$1 = (rPr, value) => {
	rPr.children = rPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "solidFill"));
	if (value === null) return;
	const parsed = parseColor(value);
	if (parsed === null) throw new Error(`unrecognized color: ${value}`);
	insertChildByRank(rPr, elem(NAME_SOLID_FILL$6, { children: [parsed.kind === "srgb" ? elem(NAME_SRGB_CLR$3, { attrs: [attr(ATTR_VAL$8, parsed.hex)] }) : elem(NAME_SCHEME_CLR$1, { attrs: [attr(ATTR_VAL$8, parsed.token)] })] }), rprChildRank);
};
const setLatin = (rPr, font) => {
	rPr.children = rPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "latin"));
	if (font === null) return;
	insertChildByRank(rPr, elem(NAME_LATIN, { attrs: [attr(ATTR_TYPEFACE$3, font)] }), rprChildRank);
};
const setEastAsian = (rPr, font) => {
	rPr.children = rPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "ea"));
	if (font === null) return;
	insertChildByRank(rPr, elem(NAME_EA, { attrs: [attr(ATTR_TYPEFACE$3, font)] }), rprChildRank);
};
const setComplexScript = (rPr, font) => {
	rPr.children = rPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "cs"));
	if (font === null) return;
	insertChildByRank(rPr, elem(NAME_CS, { attrs: [attr(ATTR_TYPEFACE$3, font)] }), rprChildRank);
};
const setHighlight = (rPr, value) => {
	rPr.children = rPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "highlight"));
	if (value === null) return;
	const parsed = parseColor(value);
	if (parsed === null) throw new Error(`unrecognized highlight color: ${value}`);
	insertChildByRank(rPr, elem(NAME_HIGHLIGHT, { children: [parsed.kind === "srgb" ? elem(NAME_SRGB_CLR$3, { attrs: [attr(ATTR_VAL$8, parsed.hex)] }) : elem(NAME_SCHEME_CLR$1, { attrs: [attr(ATTR_VAL$8, parsed.token)] })] }), rprChildRank);
};
const validateFormatEnums = (format, caller) => {
	if (format.underline != null && typeof format.underline !== "boolean") oneOf(format.underline, UNDERLINES, `${caller}: underline`);
	if (format.strike != null && typeof format.strike !== "boolean") oneOf(format.strike, STRIKES, `${caller}: strike`);
	if (format.cap != null) oneOf(format.cap, [
		"none",
		"small",
		"all"
	], `${caller}: cap`);
};
/** Mutates `rPr` in place per `format`. */
const applyRunFormat = (rPr, format, caller = "setShapeRunFormat") => {
	validateFormatEnums(format, caller);
	applyValidatedRunFormat(rPr, format);
};
const applyValidatedRunFormat = (rPr, format) => {
	let attrs = rPr.attrs;
	if (format.size !== void 0) {
		const sz = fontSizeHundredthPt(format.size * 100, "setShapeRunFormat: size");
		attrs = setOrRemoveAttr(attrs, ATTR_SZ, String(sz));
	}
	if (format.bold !== void 0) attrs = setOrRemoveAttr(attrs, ATTR_B, format.bold ? "1" : "0");
	if (format.italic !== void 0) attrs = setOrRemoveAttr(attrs, ATTR_I, format.italic ? "1" : "0");
	if (format.underline !== void 0) {
		const value = format.underline === false ? "none" : format.underline === true ? "sng" : format.underline;
		attrs = setOrRemoveAttr(attrs, ATTR_U, value);
	}
	if (format.strike !== void 0) {
		const value = format.strike === false ? "noStrike" : format.strike === true ? "sngStrike" : format.strike;
		attrs = setOrRemoveAttr(attrs, ATTR_STRIKE, value);
	}
	if (format.spc !== void 0) {
		const spc = textPointSpacing(format.spc, "setShapeRunFormat: spc");
		attrs = setOrRemoveAttr(attrs, ATTR_SPC, String(spc));
	}
	if (format.kern !== void 0) attrs = setOrRemoveAttr(attrs, ATTR_KERN, String(Math.round(format.kern)));
	if (format.baseline !== void 0) {
		const pct = Math.round(format.baseline * 1e5);
		attrs = setOrRemoveAttr(attrs, ATTR_BASELINE, String(pct));
	}
	if (format.cap !== void 0) attrs = setOrRemoveAttr(attrs, ATTR_CAP, format.cap);
	rPr.attrs = attrs;
	if (format.font !== void 0) setLatin(rPr, format.font);
	if (format.fontEastAsian !== void 0) setEastAsian(rPr, format.fontEastAsian);
	if (format.fontComplexScript !== void 0) setComplexScript(rPr, format.fontComplexScript);
	if (format.color !== void 0) setSolidFill$1(rPr, format.color);
	if (format.highlight !== void 0) setHighlight(rPr, format.highlight);
};
/**
* Walks `txBody`, ensuring every `<a:r>` has an `<a:rPr>` carrying the
* supplied format. Existing run-property attributes not addressed by
* `format` are preserved.
*/
const applyFormatToAllRuns = (txBody, format, caller = "setShapeTextFormat") => {
	validateFormatEnums(format, caller);
	applyValidatedFormatToAllRuns(txBody, format);
};
const applyValidatedFormatToAllRuns = (txBody, format) => {
	for (const p of txBody.children) {
		if (p.kind !== "element" || p.name.namespaceURI !== NS.dml || p.name.localName !== "p") continue;
		for (const r of p.children) {
			if (r.kind !== "element" || r.name.namespaceURI !== NS.dml || r.name.localName !== "r") continue;
			let rPr = firstChildElement(r, NAME_RPR$6);
			if (rPr === null) {
				rPr = elem(NAME_RPR$6);
				r.children.unshift(rPr);
			}
			applyValidatedRunFormat(rPr, format);
		}
	}
};
//#endregion
//#region src/internal/drawingml/text-body-mutation.ts
const NAME_BU_CHAR = qname("a", "buChar", NS.dml);
const NAME_BU_AUTO_NUM = qname("a", "buAutoNum", NS.dml);
const NAME_BU_NONE$1 = qname("a", "buNone", NS.dml);
const NAME_BU_FONT = qname("a", "buFont", NS.dml);
const ATTR_CHAR = qname("", "char", "");
const ATTR_BU_TYPE = qname("", "type", "");
const ATTR_START_AT = qname("", "startAt", "");
const ATTR_TYPEFACE$2 = qname("", "typeface", "");
const NAME_P$5 = qname("a", "p", NS.dml);
const NAME_R$4 = qname("a", "r", NS.dml);
const NAME_T$5 = qname("a", "t", NS.dml);
const NAME_RPR$5 = qname("a", "rPr", NS.dml);
const NAME_PPR$1 = qname("a", "pPr", NS.dml);
const NAME_END_PARA_RPR = qname("a", "endParaRPr", NS.dml);
NS.xml;
const cloneAttrs = (attrs) => attrs.map((a) => attr(a.name, a.value));
const cloneElement = (e) => elem(e.name, {
	attrs: cloneAttrs(e.attrs),
	prefixDecls: new Map(e.prefixDecls),
	children: e.children.map(cloneNode)
});
const cloneNode = (n) => {
	switch (n.kind) {
		case "element": return cloneElement(n);
		case "text": return {
			kind: "text",
			data: n.data
		};
		case "cdata": return {
			kind: "cdata",
			data: n.data
		};
		case "comment": return {
			kind: "comment",
			data: n.data
		};
		case "pi": return {
			kind: "pi",
			target: n.target,
			data: n.data
		};
	}
};
/**
* Returns the first `a:rPr` reachable on the first run of the first paragraph
* inside `txBody`. Used to preserve formatting on text replacement: we clone
* the original rPr into the new run so font, color, size, etc. survive.
*/
const findFirstRunProperties = (txBody) => {
	const firstP = firstChildElement(txBody, NAME_P$5);
	if (firstP === null) return null;
	const firstR = firstChildElement(firstP, NAME_R$4);
	if (firstR === null) return null;
	return firstChildElement(firstR, NAME_RPR$5);
};
/**
* Returns the first `a:pPr` from the first paragraph. Used to preserve
* paragraph-level formatting (alignment, bullet, indent) when replacing.
*/
const findFirstParagraphProperties = (txBody) => {
	const firstP = firstChildElement(txBody, NAME_P$5);
	if (firstP === null) return null;
	return firstChildElement(firstP, NAME_PPR$1);
};
const removeAllParagraphs = (txBody) => {
	txBody.children = txBody.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "p"));
};
const TOKEN_PATTERN = /\{\{([^{}]+)\}\}/g;
/**
* Replaces `{{key}}` tokens in every `a:t` element under `root` with values
* from `tokens`. Tokens whose key is not in `tokens` are left untouched.
*
* Returns the number of substitutions performed. Useful for callers that
* want to know whether anything matched.
*
* Limitation: a token must fit entirely within one `<a:t>` element to
* match. PowerPoint normally serializes contiguous user text as a single
* `<a:t>`, so the limitation only bites when a placeholder was edited
* character-by-character (causing PowerPoint to split runs). For those
* cases, fall back to `setText()`.
*/
const replaceTokensInTree = (root, tokens) => {
	let count = 0;
	walkElements(root, (el) => {
		if (el.name.namespaceURI !== NAME_T$5.namespaceURI) return;
		if (el.name.localName !== "t") return;
		const child = el.children[0];
		if (!child || child.kind !== "text") return;
		const before = child.data;
		let didMatch = false;
		const after = before.replace(TOKEN_PATTERN, (match, key) => {
			if (Object.hasOwn(tokens, key)) {
				didMatch = true;
				return tokens[key] ?? "";
			}
			return match;
		});
		if (didMatch) {
			child.data = after;
			count++;
		}
	});
	return count;
};
/**
* Replaces every occurrence of `from` in every `<a:t>` element under
* `root` with `to`. `from` may be a string (literal) or a `RegExp`
* (matched per-run). Returns the count of `<a:t>` elements that were
* mutated — not the count of substitutions inside them, since callers
* usually want "did anything change" rather than "how many letters
* moved."
*
* Same single-run constraint as `replaceTokensInTree`: matches must
* fit inside one `<a:t>`. Use this for the broader "find/replace
* across the deck" use case where {{token}} syntax isn't a fit.
*/
const replaceTextInTree = (root, from, to) => {
	const pattern = typeof from === "string" ? new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : from.global ? from : new RegExp(from.source, `${from.flags}g`);
	let count = 0;
	walkElements(root, (el) => {
		if (el.name.namespaceURI !== NAME_T$5.namespaceURI) return;
		if (el.name.localName !== "t") return;
		const child = el.children[0];
		if (!child || child.kind !== "text") return;
		const before = child.data;
		const after = before.replace(pattern, to);
		if (after !== before) {
			child.data = after;
			count++;
		}
	});
	return count;
};
const normalizeBulletStyle = (s, caller) => {
	if (typeof s === "string") oneOf(s, [
		"bullet",
		"number",
		"none"
	], `${caller}: bullets`);
	if (s === "bullet") return {
		kind: "char",
		char: "•"
	};
	if (s === "number") return {
		kind: "autoNum",
		type: "arabicPeriod"
	};
	if (s === "none") return { kind: "none" };
	if ("char" in s) return {
		kind: "char",
		char: s.char
	};
	return {
		kind: "autoNum",
		type: oneOf(s.autoNum, AUTO_NUMBER_SCHEMES, `${caller}: bullets.autoNum`)
	};
};
const buildBulletElement = (n) => {
	switch (n.kind) {
		case "char": return elem(NAME_BU_CHAR, { attrs: [attr(ATTR_CHAR, n.char)] });
		case "autoNum": return elem(NAME_BU_AUTO_NUM, { attrs: [attr(ATTR_START_AT, "1"), attr(ATTR_BU_TYPE, n.type)] });
		case "none": return elem(NAME_BU_NONE$1);
	}
};
const NAME_PPR_FOR_BULLET = qname("a", "pPr", NS.dml);
const NAME_P_FOR_BULLET = qname("a", "p", NS.dml);
const ALIGNMENT_TOKENS = [
	"l",
	"ctr",
	"r",
	"just",
	"dist",
	"justLow",
	"thaiDist"
];
/**
* Parses an `algn` attribute value from a file. A value outside
* `ST_TextAlignType` is malformed input and reads as unset.
*/
const parseAlignmentToken = (value) => ALIGNMENT_TOKENS.find((token) => token === value) ?? null;
const alignToken = (a, caller) => {
	oneOf(a, [
		"left",
		"center",
		"right",
		"justify",
		"distribute",
		"l",
		"ctr",
		"r",
		"just",
		"dist",
		"justLow",
		"thaiDist"
	], `${caller}: align`);
	switch (a) {
		case "left":
		case "l": return "l";
		case "center":
		case "ctr": return "ctr";
		case "right":
		case "r": return "r";
		case "justify":
		case "just": return "just";
		case "distribute":
		case "dist": return "dist";
		default: return a;
	}
};
const ATTR_ALGN$1 = qname("", "algn", "");
/**
* Sets `<a:pPr algn="...">` on every paragraph in `txBody`. Existing
* pPr attributes other than `algn` are preserved.
*/
const applyAlignmentToAllParagraphs = (txBody, align, caller = "setShapeAlignment") => {
	applyAlignmentTokenToAllParagraphs(txBody, alignToken(align, caller));
};
const applyAlignmentTokenToAllParagraphs = (txBody, token) => {
	for (const p of txBody.children) {
		if (p.kind !== "element" || p.name.namespaceURI !== NAME_P_FOR_BULLET.namespaceURI || p.name.localName !== "p") continue;
		let pPr = firstChildElement(p, NAME_PPR_FOR_BULLET);
		if (pPr === null) {
			pPr = elem(NAME_PPR_FOR_BULLET);
			p.children.unshift(pPr);
		}
		pPr.attrs = pPr.attrs.filter((a) => a.name.localName !== "algn");
		pPr.attrs.push(attr(ATTR_ALGN$1, token));
	}
};
/**
* Sets the bullet style on a single `<a:p>` paragraph. Drops any
* existing bullet child element (`a:buChar`, `a:buAutoNum`, `a:buNone`)
* before inserting the new one. Creates `<a:pPr>` if absent.
*/
const BULLET_INDENT_BY_LEVEL = [
	{
		marL: 342900,
		indent: -342900
	},
	{
		marL: 742950,
		indent: -285750
	},
	{
		marL: 1143e3,
		indent: -228600
	},
	{
		marL: 1600200,
		indent: -228600
	},
	{
		marL: 2057400,
		indent: -228600
	}
];
const bulletIndentForLevel = (lvl) => BULLET_INDENT_BY_LEVEL[Math.min(lvl, BULLET_INDENT_BY_LEVEL.length - 1)];
const ATTR_MAR_L$1 = qname("", "marL", "");
const ATTR_INDENT$1 = qname("", "indent", "");
const updateBulletIndentForLevel = (pPr, previousLevel, level) => {
	const previous = bulletIndentForLevel(previousLevel);
	const marL = pPr.attrs.find((a) => a.name.namespaceURI === "" && a.name.localName === "marL");
	const indent = pPr.attrs.find((a) => a.name.namespaceURI === "" && a.name.localName === "indent");
	if (marL?.value !== String(previous.marL) || indent?.value !== String(previous.indent)) return;
	const next = bulletIndentForLevel(level);
	pPr.attrs = pPr.attrs.map((a) => a === marL ? attr(a.name, String(next.marL)) : a === indent ? attr(a.name, String(next.indent)) : a);
};
const hasAttr = (el, local) => el.attrs.some((a) => a.name.namespaceURI === "" && a.name.localName === local);
const applyNormalizedBullet = (paragraph, style) => {
	let pPr = firstChildElement(paragraph, NAME_PPR_FOR_BULLET);
	if (pPr === null) {
		pPr = elem(NAME_PPR_FOR_BULLET);
		paragraph.children.unshift(pPr);
	}
	pPr.children = pPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && (c.name.localName === "buChar" || c.name.localName === "buAutoNum" || c.name.localName === "buNone" || c.name.localName === "buFont")));
	if (style.kind !== "none") {
		const lvl = Number.parseInt(pPr.attrs.find((a) => a.name.localName === "lvl")?.value ?? "0", 10);
		const { marL, indent } = bulletIndentForLevel(Number.isFinite(lvl) ? lvl : 0);
		if (!hasAttr(pPr, "marL")) pPr.attrs.push(attr(ATTR_MAR_L$1, String(marL)));
		if (!hasAttr(pPr, "indent")) pPr.attrs.push(attr(ATTR_INDENT$1, String(indent)));
	}
	if (style.kind === "autoNum") pPr.children.push(elem(NAME_BU_FONT, { attrs: [attr(ATTR_TYPEFACE$2, "+mj-lt")] }));
	pPr.children.push(buildBulletElement(style));
};
const applyBulletToParagraph = (paragraph, style) => {
	applyNormalizedBullet(paragraph, normalizeBulletStyle(style, "setParagraphBullet"));
};
const applyBulletToAllParagraphs = (txBody, style) => {
	const normalized = normalizeBulletStyle(style, "setShapeBulletStyle");
	for (const p of txBody.children) {
		if (p.kind !== "element" || p.name.namespaceURI !== NAME_P_FOR_BULLET.namespaceURI || p.name.localName !== "p") continue;
		applyNormalizedBullet(p, normalized);
	}
};
/**
* Replaces the entire visible text of a `txBody` element with `value`.
* Newlines in `value` start a new paragraph.
*
* The first existing `a:rPr` (run properties) and `a:pPr` (paragraph
* properties) are cloned into every new paragraph so that font, color, size,
* alignment, and bullet style survive the replacement. If the source had
* mixed formatting per run, that gets collapsed into the first-run formatting
* across the entire new text — matching what PowerPoint does when you select
* all and type.
*
* The `bodyPr` and `lstStyle` children (if any) are preserved untouched.
*/
const setTextBody = (txBody, value, bullets) => {
	const normalized = bullets === void 0 ? void 0 : normalizeBulletStyle(bullets, "setShapeText");
	const rPrTemplate = findFirstRunProperties(txBody);
	const pPrTemplate = findFirstParagraphProperties(txBody);
	removeAllParagraphs(txBody);
	const lines = value.split("\n");
	for (const line of lines) {
		const t = elem(NAME_T$5, { children: line.length > 0 ? [text(line)] : [] });
		const r = elem(NAME_R$4, { children: rPrTemplate !== null ? [cloneElement(rPrTemplate), t] : [t] });
		const p = elem(NAME_P$5, { children: pPrTemplate !== null ? [cloneElement(pPrTemplate), r] : [r] });
		if (normalized !== void 0) applyNormalizedBullet(p, normalized);
		txBody.children.push(p);
	}
};
/**
* Builds the `<a:p>` elements for `paragraphs`. Every format is validated
* here, so a caller that builds before it touches the tree leaves the
* existing text intact when a value is rejected.
*/
const buildTextBodyParagraphs = (paragraphs, caller = "setShapeParagraphs") => {
	if (paragraphs.length === 0) throw new Error("setTextBodyParagraphs: at least one paragraph is required");
	const built = [];
	for (const para of paragraphs) {
		const children = [];
		if (para.align !== void 0) children.push(elem(NAME_PPR$1, { attrs: [attr(ATTR_ALGN$1, alignToken(para.align, caller))] }));
		for (const run of para.runs) {
			const rPr = elem(NAME_RPR$5);
			if (run.format !== void 0) applyRunFormat(rPr, run.format, caller);
			const t = elem(NAME_T$5, { children: run.text.length > 0 ? [text(run.text)] : [] });
			children.push(elem(NAME_R$4, { children: [rPr, t] }));
		}
		if (para.endFormat !== void 0) {
			const endParaRPr = elem(NAME_END_PARA_RPR);
			applyRunFormat(endParaRPr, para.endFormat, caller);
			children.push(endParaRPr);
		}
		built.push(elem(NAME_P$5, { children }));
	}
	return built;
};
const replaceTextBodyParagraphs = (txBody, built) => {
	removeAllParagraphs(txBody);
	txBody.children.push(...built);
};
/**
* Replaces every paragraph of `txBody` with explicitly structured ones.
* Unlike `setTextBody`, nothing is inherited from the existing runs: each
* run gets a fresh `<a:rPr>` carrying only its own `format`. A rejected
* format throws before `txBody` changes.
*/
const setTextBodyParagraphs = (txBody, paragraphs) => {
	replaceTextBodyParagraphs(txBody, buildTextBodyParagraphs(paragraphs));
};
//#endregion
//#region src/internal/drawingml/fill.ts
const NAME_SOLID_FILL$5 = qname("a", "solidFill", NS.dml);
const NAME_NO_FILL$2 = qname("a", "noFill", NS.dml);
const NAME_GRAD_FILL = qname("a", "gradFill", NS.dml);
const NAME_GS_LST = qname("a", "gsLst", NS.dml);
const NAME_GS = qname("a", "gs", NS.dml);
const NAME_LIN = qname("a", "lin", NS.dml);
const NAME_PATH = qname("a", "path", NS.dml);
const NAME_FILL_TO_RECT = qname("a", "fillToRect", NS.dml);
const ATTR_PATH = qname("", "path", "");
const ATTR_POS = qname("", "pos", "");
const ATTR_ANG = qname("", "ang", "");
const ATTR_SCALED = qname("", "scaled", "");
const ATTR_FLIP = qname("", "flip", "");
const ATTR_ROT_WITH_SHAPE$1 = qname("", "rotWithShape", "");
const FILL_CHOICE_LOCAL_NAMES = new Set([
	"noFill",
	"solidFill",
	"gradFill",
	"blipFill",
	"pattFill",
	"grpFill"
]);
const removeAnyFill = (host) => {
	host.children = host.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && FILL_CHOICE_LOCAL_NAMES.has(c.name.localName)));
};
/**
* Returns the index where the fill should be inserted on `host` per the
* schema's child-element sequence. For `<p:spPr>` that's right after the
* geometry element; for `<p:bgPr>` it's the start.
*
* The schema is more nuanced (xfrm → geometry → fill → ln → effects →
* scene3d → sp3d → extLst) but PowerPoint tolerates any of those slots
* being absent, and we only care about staying ahead of `a:ln`.
*/
const fillInsertionIndex = (host) => {
	for (let i = 0; i < host.children.length; i++) {
		const c = host.children[i];
		if (c?.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "ln") return i;
		if (c.name.localName === "effectLst" || c.name.localName === "effectDag") return i;
		if (c.name.localName === "scene3d" || c.name.localName === "sp3d") return i;
		if (c.name.localName === "extLst") return i;
	}
	return host.children.length;
};
/** Sets `<a:solidFill>` on `host`, removing any previous fill choice. */
const setSolidFill = (host, color) => {
	removeAnyFill(host);
	const fill = elem(NAME_SOLID_FILL$5, { children: [buildColorElement(color)] });
	host.children.splice(fillInsertionIndex(host), 0, fill);
};
/** Sets `<a:noFill>` on `host`, removing any previous fill choice. */
const setNoFill = (host) => {
	removeAnyFill(host);
	host.children.splice(fillInsertionIndex(host), 0, elem(NAME_NO_FILL$2));
};
/**
* Removes any fill choice from `host` entirely. The shape then inherits
* its fill from the layout / master placeholder it descends from.
*/
const clearFill = (host) => {
	removeAnyFill(host);
};
/** Every `ST_PresetPatternVal` token (ECMA-376 dml-main.xsd). */
const PATTERN_PRESETS = [
	"pct5",
	"pct10",
	"pct20",
	"pct25",
	"pct30",
	"pct40",
	"pct50",
	"pct60",
	"pct70",
	"pct75",
	"pct80",
	"pct90",
	"horz",
	"vert",
	"ltHorz",
	"ltVert",
	"dkHorz",
	"dkVert",
	"narHorz",
	"narVert",
	"dashHorz",
	"dashVert",
	"cross",
	"dnDiag",
	"upDiag",
	"ltDnDiag",
	"ltUpDiag",
	"dkDnDiag",
	"dkUpDiag",
	"wdDnDiag",
	"wdUpDiag",
	"dashDnDiag",
	"dashUpDiag",
	"diagCross",
	"smCheck",
	"lgCheck",
	"smGrid",
	"lgGrid",
	"dotGrid",
	"smConfetti",
	"lgConfetti",
	"horzBrick",
	"diagBrick",
	"solidDmnd",
	"openDmnd",
	"dotDmnd",
	"plaid",
	"sphere",
	"weave",
	"divot",
	"shingle",
	"wave",
	"trellis",
	"zigZag"
];
const NAME_PATT_FILL = qname("a", "pattFill", NS.dml);
const NAME_FG_CLR = qname("a", "fgClr", NS.dml);
const NAME_BG_CLR = qname("a", "bgClr", NS.dml);
const ATTR_PRST$4 = qname("", "prst", "");
/**
* Sets `<a:pattFill>` on `host` with the given preset + colors.
* Replaces any previous fill choice.
*/
const setPatternFill = (host, options) => {
	removeAnyFill(host);
	const pattFill = elem(NAME_PATT_FILL, {
		attrs: [attr(ATTR_PRST$4, oneOf(options.preset, PATTERN_PRESETS, "setShapePatternFill: preset"))],
		children: [elem(NAME_FG_CLR, { children: [buildColorElement(options.foreground)] }), elem(NAME_BG_CLR, { children: [buildColorElement(options.background)] })]
	});
	host.children.splice(fillInsertionIndex(host), 0, pattFill);
};
/** Sets `<a:gradFill>` on `host`, replacing any previous fill choice. */
const setGradientFill = (host, options) => {
	if (options.path !== void 0) oneOf(options.path, [
		"linear",
		"circle",
		"rect",
		"shape"
	], "setShapeGradientFill: path");
	if (options.stops.length < 2) throw new Error("gradient fill requires at least two stops");
	removeAnyFill(host);
	const stops = options.stops.map((s) => {
		if (!Number.isFinite(s.offset) || s.offset < 0 || s.offset > 1) throw new RangeError(`gradient stop offset must be in [0, 1], got ${s.offset}`);
		return elem(NAME_GS, {
			attrs: [attr(ATTR_POS, String(Math.round(s.offset * 1e5)))],
			children: [buildColorElement(s.color)]
		});
	});
	const pct = (n) => String(Math.round(n * 1e5));
	const directionEl = options.path === void 0 || options.path === "linear" ? (() => {
		const norm = ((options.angleDeg ?? 90) % 360 + 360) % 360;
		return elem(NAME_LIN, { attrs: [attr(ATTR_ANG, String(Math.round(norm * 6e4))), attr(ATTR_SCALED, "0")] });
	})() : elem(NAME_PATH, {
		attrs: [attr(ATTR_PATH, options.path)],
		children: options.focus === void 0 ? [] : [elem(NAME_FILL_TO_RECT, { attrs: [
			attr(qname("", "l", ""), pct(options.focus.left)),
			attr(qname("", "t", ""), pct(options.focus.top)),
			attr(qname("", "r", ""), pct(options.focus.right)),
			attr(qname("", "b", ""), pct(options.focus.bottom))
		] })]
	});
	const grad = elem(NAME_GRAD_FILL, {
		attrs: [attr(ATTR_FLIP, "none"), attr(ATTR_ROT_WITH_SHAPE$1, "1")],
		children: [elem(NAME_GS_LST, { children: stops }), directionEl]
	});
	host.children.splice(fillInsertionIndex(host), 0, grad);
};
//#endregion
//#region src/internal/drawingml/effects.ts
const NAME_EFFECT_LST = qname("a", "effectLst", NS.dml);
const NAME_OUTER_SHDW = qname("a", "outerShdw", NS.dml);
const NAME_GLOW = qname("a", "glow", NS.dml);
const NAME_ALPHA = qname("a", "alpha", NS.dml);
const ATTR_BLUR_RAD = qname("", "blurRad", "");
const ATTR_DIST = qname("", "dist", "");
const ATTR_DIR$1 = qname("", "dir", "");
const ATTR_ALGN = qname("", "algn", "");
const ATTR_ROT_WITH_SHAPE = qname("", "rotWithShape", "");
const ATTR_RAD = qname("", "rad", "");
const ATTR_VAL$7 = qname("", "val", "");
/**
* Computes the index inside `host.children` where an `<a:effectLst>`
* should be inserted to satisfy the spec's child ordering on
* `<p:spPr>`.
*/
const effectInsertionIndex = (host) => {
	for (let i = 0; i < host.children.length; i++) {
		const c = host.children[i];
		if (c?.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "scene3d" || c.name.localName === "sp3d") return i;
		if (c.name.localName === "extLst") return i;
	}
	return host.children.length;
};
const removeEffectLst = (host) => {
	host.children = host.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "effectLst"));
};
const colorWithAlpha = (color, opacity) => {
	const base = buildColorElement(color);
	if (opacity !== void 0 && opacity >= 0 && opacity < 1) {
		const amt = Math.round(opacity * 1e5);
		base.children.push(elem(NAME_ALPHA, { attrs: [attr(ATTR_VAL$7, String(amt))] }));
	}
	return base;
};
/**
* Sets an outer shadow on `host`'s effect list. Replaces any prior
* `<a:effectLst>` entirely (we treat shadow + glow as mutually
* exclusive in v1 — multi-effect stacks are a post-1.0 enhancement).
*/
const setShadow = (host, options = {}) => {
	removeEffectLst(host);
	const color = options.color ?? "#000000";
	const blur = emuExtent(options.blurEmu ?? 50800, "setShapeShadow: blurEmu");
	const dist = emuExtent(options.offsetEmu ?? 38100, "setShapeShadow: offsetEmu");
	const angleDeg = options.angleDeg ?? 45;
	const dir = String(Math.round((angleDeg % 360 + 360) % 360 * 6e4));
	const effectLst = elem(NAME_EFFECT_LST, { children: [elem(NAME_OUTER_SHDW, {
		attrs: [
			attr(ATTR_BLUR_RAD, String(blur)),
			attr(ATTR_DIST, String(dist)),
			attr(ATTR_DIR$1, dir),
			attr(ATTR_ALGN, "tl"),
			attr(ATTR_ROT_WITH_SHAPE, "0")
		],
		children: [colorWithAlpha(color, options.opacity)]
	})] });
	host.children.splice(effectInsertionIndex(host), 0, effectLst);
};
/**
* Sets a glow on `host`'s effect list. Replaces any prior
* `<a:effectLst>`.
*/
const setGlow = (host, options) => {
	removeEffectLst(host);
	const effectLst = elem(NAME_EFFECT_LST, { children: [elem(NAME_GLOW, {
		attrs: [attr(ATTR_RAD, String(emuExtent(options.radiusEmu ?? 63500, "setShapeGlow: radiusEmu")))],
		children: [buildColorElement(options.color)]
	})] });
	host.children.splice(effectInsertionIndex(host), 0, effectLst);
};
/** Removes any effect list from `host`. */
const clearEffects = (host) => {
	removeEffectLst(host);
};
//#endregion
//#region src/internal/drawingml/stroke.ts
const NAME_LN$1 = qname("a", "ln", NS.dml);
const NAME_SOLID_FILL$4 = qname("a", "solidFill", NS.dml);
const NAME_NO_FILL$1 = qname("a", "noFill", NS.dml);
const ATTR_W$3 = qname("", "w", "");
const FILL_LOCALS = new Set([
	"noFill",
	"solidFill",
	"gradFill",
	"pattFill"
]);
const LN_CHILD_RANK = {
	noFill: 0,
	solidFill: 0,
	gradFill: 0,
	pattFill: 0,
	prstDash: 1,
	custDash: 1,
	round: 2,
	bevel: 2,
	miter: 2,
	headEnd: 3,
	tailEnd: 4,
	extLst: 5
};
const lnChildRank = (el) => el.name.namespaceURI === NS.dml ? LN_CHILD_RANK[el.name.localName] ?? 99 : 99;
const insertLnChild = (ln, el) => insertChildByRank(ln, el, lnChildRank);
const removeChildrenIn = (host, names) => {
	host.children = host.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && names.has(c.name.localName)));
};
const ensureLn = (spPr) => {
	for (const c of spPr.children) if (c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "ln") return c;
	const ln = elem(NAME_LN$1);
	const afterLn = new Set([
		"effectLst",
		"effectDag",
		"scene3d",
		"sp3d",
		"extLst"
	]);
	for (let i = 0; i < spPr.children.length; i++) {
		const c = spPr.children[i];
		if (c?.kind === "element" && c.name.namespaceURI === NS.dml && afterLn.has(c.name.localName)) {
			spPr.children.splice(i, 0, ln);
			return ln;
		}
	}
	spPr.children.push(ln);
	return ln;
};
/** Sets a solid-color outline on a shape's spPr. */
const setSolidStroke = (spPr, options) => {
	const ln = ensureLn(spPr);
	if (options.widthEmu !== void 0) {
		ln.attrs = ln.attrs.filter((a) => a.name.localName !== "w");
		ln.attrs.push(attr(ATTR_W$3, String(lineWidthEmu(options.widthEmu, "setShapeStroke: widthEmu"))));
	}
	removeChildrenIn(ln, FILL_LOCALS);
	if (options.color !== void 0) insertLnChild(ln, elem(NAME_SOLID_FILL$4, { children: [buildColorElement(options.color)] }));
};
/** Sets an explicit "no outline" on a shape's spPr. */
const setNoStroke = (spPr) => {
	const ln = ensureLn(spPr);
	removeChildrenIn(ln, FILL_LOCALS);
	insertLnChild(ln, elem(NAME_NO_FILL$1));
};
/** Removes any `<a:ln>` from a shape's spPr (restores inheritance). */
const clearStroke = (spPr) => {
	spPr.children = spPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "ln"));
};
const NAME_PRST_DASH = qname("a", "prstDash", NS.dml);
const ATTR_VAL$6 = qname("", "val", "");
/**
* Sets `<a:prstDash val="..."/>` inside the shape's `<a:ln>`. Creates
* `<a:ln>` if absent. Replacing the dash choice on subsequent calls.
*/
const setStrokeDash = (spPr, dash) => {
	oneOf(dash, LINE_DASHES, "setShapeStrokeDash: dash");
	const ln = ensureLn(spPr);
	ln.children = ln.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "prstDash"));
	insertLnChild(ln, elem(NAME_PRST_DASH, { attrs: [attr(ATTR_VAL$6, dash)] }));
};
const ATTR_TYPE$5 = qname("", "type", "");
const ATTR_LEN = qname("", "len", "");
/**
* Sets an arrowhead on one end of the shape's outline. `end` selects
* which sentinel element: `'head'` → `<a:headEnd>`, `'tail'` →
* `<a:tailEnd>`. Creates `<a:ln>` if absent and replaces any prior
* arrowhead on the selected end.
*
* Pass `{ type: 'none' }` to clear an existing arrowhead (this still
* emits the element with `type="none"`, matching PowerPoint's
* behavior).
*/
const setStrokeArrow = (spPr, end, options) => {
	oneOf(end, ["head", "tail"], "setShapeStrokeArrow: end");
	oneOf(options.type, [
		"none",
		"triangle",
		"stealth",
		"diamond",
		"oval",
		"arrow"
	], "setShapeStrokeArrow: type");
	if (options.width !== void 0) oneOf(options.width, [
		"sm",
		"med",
		"lg"
	], "setShapeStrokeArrow: width");
	if (options.length !== void 0) oneOf(options.length, [
		"sm",
		"med",
		"lg"
	], "setShapeStrokeArrow: length");
	const ln = ensureLn(spPr);
	const localName = {
		head: "headEnd",
		tail: "tailEnd"
	}[end];
	ln.children = ln.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === localName));
	const attrs = [attr(ATTR_TYPE$5, options.type)];
	if (options.width !== void 0) attrs.push(attr(ATTR_W$3, options.width));
	if (options.length !== void 0) attrs.push(attr(ATTR_LEN, options.length));
	insertLnChild(ln, elem(qname("a", localName, NS.dml), { attrs }));
};
/** Sets `<a:ln cap="…"/>`. Pass `null` to clear the attribute. */
const setStrokeCap = (spPr, cap) => {
	if (cap !== null) oneOf(cap, [
		"rnd",
		"sq",
		"flat"
	], "setShapeStrokeCap: cap");
	const ln = ensureLn(spPr);
	ln.attrs = ln.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "cap"));
	if (cap !== null) ln.attrs.push(attr(qname("", "cap", ""), cap));
};
const JOIN_LOCALS = new Set([
	"round",
	"bevel",
	"miter"
]);
/** Replaces the join child of `<a:ln>`. Pass `null` to remove it. */
const setStrokeJoin = (spPr, join) => {
	if (join !== null) oneOf(join, [
		"round",
		"bevel",
		"miter"
	], "setShapeStrokeJoin: join");
	const ln = ensureLn(spPr);
	removeChildrenIn(ln, JOIN_LOCALS);
	if (join !== null) insertLnChild(ln, elem(qname("a", join, NS.dml)));
};
/** Sets `<a:ln cmpd="…"/>`. Pass `null` to clear the attribute. */
const setStrokeCompound = (spPr, cmpd) => {
	if (cmpd !== null) oneOf(cmpd, [
		"sng",
		"dbl",
		"thickThin",
		"thinThick",
		"tri"
	], "setShapeStrokeCompound: cmpd");
	const ln = ensureLn(spPr);
	ln.attrs = ln.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "cmpd"));
	if (cmpd !== null) ln.attrs.push(attr(qname("", "cmpd", ""), cmpd));
};
//#endregion
//#region src/internal/drawingml/custom-geometry.ts
/**
* Thrown internally when a formula references a guide name that was never
* defined, or when an unknown `fmla` operator appears. Both are malformed
* input rather than bugs, so the public reader catches *only this class*
* and reports it as "geometry could not be evaluated" (returns `null`),
* while letting any genuine programming error propagate.
*/
var GeomEvalError = class extends Error {};
const ATTR_NAME$13 = qname("", "name", "");
const ATTR_FMLA$1 = qname("", "fmla", "");
const ATTR_X$9 = qname("", "x", "");
const ATTR_Y$9 = qname("", "y", "");
const ATTR_W$2 = qname("", "w", "");
const ATTR_H$1 = qname("", "h", "");
const ATTR_WR = qname("", "wR", "");
const ATTR_HR = qname("", "hR", "");
const ATTR_ST_ANG = qname("", "stAng", "");
const ATTR_SW_ANG = qname("", "swAng", "");
const ATTR_FILL$2 = qname("", "fill", "");
const ATTR_STROKE = qname("", "stroke", "");
const NAME_AV_LST$5 = qname("a", "avLst", NS.dml);
const NAME_GD_LST = qname("a", "gdLst", NS.dml);
const NAME_PATH_LST = qname("a", "pathLst", NS.dml);
const FULL_TURN_60K = 216e5;
const toRadians = (sixtyThousandthsDeg) => sixtyThousandthsDeg / 6e4 * (Math.PI / 180);
const NUMERIC_TOKEN = /^-?\d+(?:\.\d+)?$/;
/**
* Implicit guides every formula may reference, derived from the shape
* extents (`w`, `h` in EMU). `ss` is the short side, `ls` the long side.
* The `cdN` / `NcdN` entries are constant angles in 60000ths of a degree.
*/
const builtinGuides = (w, h) => {
	const ss = Math.min(w, h);
	const cd4 = FULL_TURN_60K / 4;
	const cd8 = FULL_TURN_60K / 8;
	return new Map([
		["w", w],
		["h", h],
		["ss", ss],
		["ls", Math.max(w, h)],
		["hc", w / 2],
		["vc", h / 2],
		["t", 0],
		["l", 0],
		["b", h],
		["r", w],
		["wd2", w / 2],
		["wd3", w / 3],
		["wd4", w / 4],
		["wd5", w / 5],
		["wd6", w / 6],
		["wd8", w / 8],
		["wd10", w / 10],
		["hd2", h / 2],
		["hd3", h / 3],
		["hd4", h / 4],
		["hd5", h / 5],
		["hd6", h / 6],
		["hd8", h / 8],
		["hd10", h / 10],
		["ssd2", ss / 2],
		["ssd4", ss / 4],
		["ssd6", ss / 6],
		["ssd8", ss / 8],
		["cd2", FULL_TURN_60K / 2],
		["cd4", cd4],
		["cd6", FULL_TURN_60K / 6],
		["cd8", cd8],
		["3cd4", 3 * cd4],
		["3cd8", 3 * cd8],
		["5cd8", 5 * cd8],
		["7cd8", 7 * cd8]
	]);
};
/** Resolves a single token to a number — literal or a defined guide. */
const resolveToken = (token, guides) => {
	if (NUMERIC_TOKEN.test(token)) return Number.parseFloat(token);
	const v = guides.get(token);
	if (v === void 0) throw new GeomEvalError(`unresolved guide reference: ${token}`);
	return v;
};
/**
* Evaluates one `fmla` string against the guides resolved so far,
* implementing the operators in ECMA-376 §20.1.9.11. Division by zero
* yields `0` (the spec's defined result, so a `/0` formula degrades to a
* point at the origin rather than `NaN`/`Infinity`).
*/
const evalFormula = (fmla, guides) => {
	const parts = fmla.trim().split(/\s+/);
	const op = parts[0];
	const a = (i) => resolveToken(parts[i + 1] ?? "", guides);
	const div = (num, den) => den === 0 ? 0 : num / den;
	switch (op) {
		case "val": return a(0);
		case "*/": return div(a(0) * a(1), a(2));
		case "+-": return a(0) + a(1) - a(2);
		case "+/": return div(a(0) + a(1), a(2));
		case "?:": return a(0) > 0 ? a(1) : a(2);
		case "abs": return Math.abs(a(0));
		case "sqrt": return Math.sqrt(a(0));
		case "max": return Math.max(a(0), a(1));
		case "min": return Math.min(a(0), a(1));
		case "mod": return Math.sqrt(a(0) * a(0) + a(1) * a(1) + a(2) * a(2));
		case "pin": {
			const lo = a(0);
			const v = a(1);
			const hi = a(2);
			return v < lo ? lo : v > hi ? hi : v;
		}
		case "sin": return a(0) * Math.sin(toRadians(a(1)));
		case "cos": return a(0) * Math.cos(toRadians(a(1)));
		case "tan": return a(0) * Math.tan(toRadians(a(1)));
		case "at2": return Math.atan2(a(1), a(0)) * 180 / Math.PI * 6e4;
		case "cat2": return a(0) * Math.cos(Math.atan2(a(2), a(1)));
		case "sat2": return a(0) * Math.sin(Math.atan2(a(2), a(1)));
		default: throw new GeomEvalError(`unknown fmla operator: ${op}`);
	}
};
const firstDmlChild = (parent, name) => {
	for (const c of parent.children) if (isElement(c) && c.name.namespaceURI === name.namespaceURI && c.name.localName === name.localName) return c;
	return null;
};
const dmlChildren = (parent, localName) => {
	const out = [];
	for (const c of parent.children) if (isElement(c) && c.name.namespaceURI === NS.dml && c.name.localName === localName) out.push(c);
	return out;
};
/**
* Evaluates `<a:gd>` children of `parent` in document order, writing each
* result into `guides`. Later guides may reference earlier ones (and may
* shadow built-ins), so order is load-bearing.
*/
const evalGuideList = (parent, guides) => {
	if (parent === null) return;
	for (const c of dmlChildren(parent, "gd")) {
		const name = getAttrValue(c, ATTR_NAME$13);
		const fmla = getAttrValue(c, ATTR_FMLA$1);
		if (name === null || fmla === null) continue;
		guides.set(name, evalFormula(fmla, guides));
	}
};
const resolvePt = (pt, guides) => ({
	x: resolveToken(getAttrValue(pt, ATTR_X$9) ?? "0", guides),
	y: resolveToken(getAttrValue(pt, ATTR_Y$9) ?? "0", guides)
});
const parsePoint = (el, guides) => {
	const pt = firstDmlChild(el, qname("a", "pt", NS.dml));
	if (pt === null) throw new GeomEvalError(`<a:${el.name.localName}> missing <a:pt>`);
	return resolvePt(pt, guides);
};
const parseIntOrNull = (raw) => {
	if (raw === null) return null;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : null;
};
const FILL_MODES = new Set([
	"none",
	"norm",
	"lighten",
	"lightenLess",
	"darken",
	"darkenLess"
]);
const isPathFillMode = (s) => FILL_MODES.has(s);
const parsePath = (pathEl, guides) => {
	const w = parseIntOrNull(getAttrValue(pathEl, ATTR_W$2));
	const h = parseIntOrNull(getAttrValue(pathEl, ATTR_H$1));
	const fillRaw = getAttrValue(pathEl, ATTR_FILL$2);
	const fill = fillRaw !== null && isPathFillMode(fillRaw) ? fillRaw : "norm";
	const strokeRaw = getAttrValue(pathEl, ATTR_STROKE);
	const stroke = !(strokeRaw === "0" || strokeRaw === "false");
	const commands = [];
	for (const c of pathEl.children) {
		if (!isElement(c) || c.name.namespaceURI !== NS.dml) continue;
		switch (c.name.localName) {
			case "moveTo":
				commands.push({
					kind: "moveTo",
					pt: parsePoint(c, guides)
				});
				break;
			case "lnTo":
				commands.push({
					kind: "lnTo",
					pt: parsePoint(c, guides)
				});
				break;
			case "close":
				commands.push({ kind: "close" });
				break;
			case "arcTo":
				commands.push({
					kind: "arcTo",
					wR: resolveToken(getAttrValue(c, ATTR_WR) ?? "0", guides),
					hR: resolveToken(getAttrValue(c, ATTR_HR) ?? "0", guides),
					stAng: resolveToken(getAttrValue(c, ATTR_ST_ANG) ?? "0", guides),
					swAng: resolveToken(getAttrValue(c, ATTR_SW_ANG) ?? "0", guides)
				});
				break;
			case "quadBezTo": {
				const pts = dmlChildren(c, "pt");
				if (pts.length < 2) throw new GeomEvalError("<a:quadBezTo> needs 2 points");
				commands.push({
					kind: "quadBezTo",
					pts: [resolvePt(pts[0], guides), resolvePt(pts[1], guides)]
				});
				break;
			}
			case "cubicBezTo": {
				const pts = dmlChildren(c, "pt");
				if (pts.length < 3) throw new GeomEvalError("<a:cubicBezTo> needs 3 points");
				commands.push({
					kind: "cubicBezTo",
					pts: [
						resolvePt(pts[0], guides),
						resolvePt(pts[1], guides),
						resolvePt(pts[2], guides)
					]
				});
				break;
			}
		}
	}
	return {
		w,
		h,
		fill,
		stroke,
		commands
	};
};
/**
* Parses `<a:custGeom>` into a fully-evaluated {@link CustomGeometry}.
* `shapeW` / `shapeH` are the shape extents in EMU, feeding the implicit
* built-in guides (`w`, `h`, `ss`, …).
*
* Returns `null` when the geometry can't be evaluated because the input is
* malformed (an unresolved guide reference, an unknown `fmla` operator, or
* a command missing its points). Callers use that to fall back to a
* placeholder rather than emit broken output.
*/
const parseCustomGeometry = (custGeom, shapeW, shapeH) => {
	try {
		const guides = builtinGuides(shapeW, shapeH);
		evalGuideList(firstDmlChild(custGeom, NAME_AV_LST$5), guides);
		evalGuideList(firstDmlChild(custGeom, NAME_GD_LST), guides);
		const pathLst = firstDmlChild(custGeom, NAME_PATH_LST);
		if (pathLst === null) return { paths: [] };
		const paths = [];
		for (const p of dmlChildren(pathLst, "path")) paths.push(parsePath(p, guides));
		return { paths };
	} catch (err) {
		if (err instanceof GeomEvalError) return null;
		throw err;
	}
};
//#endregion
//#region src/internal/drawingml/hyperlink.ts
NS.dml;
const NAME_RPR$4 = qname("a", "rPr", NS.dml);
const NAME_HLINK_CLICK$1 = qname("a", "hlinkClick", NS.dml);
const ATTR_R_ID$3 = qname("r", "id", NS.officeDocRels);
/**
* Sets `<a:hlinkClick r:id="rIdN" [tooltip="…"]/>` inside the `<a:rPr>`
* of every run in `txBody`. Pass `null` for `rId` to remove an existing
* hyperlink. When `tooltip` is `undefined` no `tooltip=` attribute is
* written; when it's a string the attribute is set. Creates `<a:rPr>`
* if absent on a run.
*/
const applyHyperlinkToAllRuns = (txBody, rId, tooltip) => {
	for (const p of txBody.children) {
		if (p.kind !== "element" || p.name.namespaceURI !== NS.dml || p.name.localName !== "p") continue;
		for (const r of p.children) {
			if (r.kind !== "element" || r.name.namespaceURI !== NS.dml || r.name.localName !== "r") continue;
			let rPr = firstChildElement(r, NAME_RPR$4);
			if (rPr === null) {
				rPr = elem(NAME_RPR$4);
				r.children.unshift(rPr);
			}
			rPr.children = rPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "hlinkClick"));
			if (rId !== null) {
				const attrs = [attr(ATTR_R_ID$3, rId)];
				if (tooltip !== void 0) attrs.push(attr(qname("", "tooltip", ""), tooltip));
				rPr.children.push(elem(NAME_HLINK_CLICK$1, { attrs }));
			}
		}
	}
};
//#endregion
//#region src/internal/drawingml/picture-mutation.ts
const NAME_BLIP_FILL$1 = qname("p", "blipFill", NS.pml);
const NAME_BLIP$1 = qname("a", "blip", NS.dml);
const ATTR_R_EMBED$2 = qname("r", "embed", NS.officeDocRels);
/**
* Returns the `r:embed` rId on this picture shape's `a:blip`. Returns null
* if the shape has no blip fill, no blip, or no embed attribute (which
* happens for picture shapes that use an external `r:link` instead).
*/
const getPictureEmbedRId = (picElement) => {
	const blipFill = firstChildElement(picElement, NAME_BLIP_FILL$1);
	if (blipFill === null) return null;
	const blip = firstChildElement(blipFill, NAME_BLIP$1);
	if (blip === null) return null;
	return getAttrValue(blip, ATTR_R_EMBED$2);
};
//#endregion
//#region src/internal/drawingml/geometry.ts
const NAME_SP_PR$7 = qname("p", "spPr", NS.pml);
const NAME_GRP_SP_PR$4 = qname("p", "grpSpPr", NS.pml);
const NAME_A_XFRM$6 = qname("a", "xfrm", NS.dml);
const NAME_P_XFRM$2 = qname("p", "xfrm", NS.pml);
const NAME_OFF$8 = qname("a", "off", NS.dml);
const NAME_EXT$9 = qname("a", "ext", NS.dml);
const ATTR_X$8 = qname("", "x", "");
const ATTR_Y$8 = qname("", "y", "");
const ATTR_CX$8 = qname("", "cx", "");
const ATTR_CY$8 = qname("", "cy", "");
const parseIntOr = (raw) => raw === null ? null : Number.isFinite(Number.parseInt(raw, 10)) ? Number.parseInt(raw, 10) : null;
const findTransform = (shape, kind) => {
	switch (kind) {
		case "shape":
		case "picture":
		case "connector": {
			const spPr = firstChildElement(shape, NAME_SP_PR$7);
			if (spPr === null) return null;
			return firstChildElement(spPr, NAME_A_XFRM$6);
		}
		case "group": {
			const grpSpPr = firstChildElement(shape, NAME_GRP_SP_PR$4);
			if (grpSpPr === null) return null;
			return firstChildElement(grpSpPr, NAME_A_XFRM$6);
		}
		case "graphicFrame": return firstChildElement(shape, NAME_P_XFRM$2);
	}
};
/** Returns the shape's position (in EMU) or `null` if `<a:off>` is absent. */
const readPosition = (shape, kind) => {
	const xfrm = findTransform(shape, kind);
	if (xfrm === null) return null;
	const off = firstChildElement(xfrm, NAME_OFF$8);
	if (off === null) return null;
	const x = parseIntOr(getAttrValue(off, ATTR_X$8));
	const y = parseIntOr(getAttrValue(off, ATTR_Y$8));
	if (x === null || y === null) return null;
	return {
		x,
		y
	};
};
/** Returns the shape's size (in EMU) or `null` if `<a:ext>` is absent. */
const readSize = (shape, kind) => {
	const xfrm = findTransform(shape, kind);
	if (xfrm === null) return null;
	const ext = firstChildElement(xfrm, NAME_EXT$9);
	if (ext === null) return null;
	const w = parseIntOr(getAttrValue(ext, ATTR_CX$8));
	const h = parseIntOr(getAttrValue(ext, ATTR_CY$8));
	if (w === null || h === null) return null;
	return {
		w,
		h
	};
};
const ATTR_ROT_R = qname("", "rot", "");
const ATTR_FLIP_H_R = qname("", "flipH", "");
const ATTR_FLIP_V_R = qname("", "flipV", "");
/**
* Returns the shape's rotation in degrees, or `0` if no rotation is set.
* ECMA-376 stores rotation in 60000ths of a degree; we divide.
*/
const readRotation = (shape, kind) => {
	const xfrm = findTransform(shape, kind);
	if (xfrm === null) return 0;
	const raw = parseIntOr(getAttrValue(xfrm, ATTR_ROT_R));
	if (raw === null) return 0;
	return raw / 6e4;
};
/** Returns the shape's flip state (h/v boolean) or `null` when no xfrm exists. */
const readFlip = (shape, kind) => {
	const xfrm = findTransform(shape, kind);
	if (xfrm === null) return null;
	return {
		horizontal: getAttrValue(xfrm, ATTR_FLIP_H_R) === "1",
		vertical: getAttrValue(xfrm, ATTR_FLIP_V_R) === "1"
	};
};
//#endregion
//#region src/internal/drawingml/geometry-mutation.ts
const NAME_SP_PR$6 = qname("p", "spPr", NS.pml);
const NAME_GRP_SP_PR$3 = qname("p", "grpSpPr", NS.pml);
const NAME_A_XFRM$5 = qname("a", "xfrm", NS.dml);
const NAME_P_XFRM$1 = qname("p", "xfrm", NS.pml);
const NAME_OFF$7 = qname("a", "off", NS.dml);
const NAME_EXT$8 = qname("a", "ext", NS.dml);
const ATTR_X$7 = qname("", "x", "");
const ATTR_Y$7 = qname("", "y", "");
const ATTR_CX$7 = qname("", "cx", "");
const ATTR_CY$7 = qname("", "cy", "");
/**
* Ensures the shape has an `<a:xfrm>` (or `<p:xfrm>` for graphic frames)
* to write into, creating the host element and its parent if absent.
* Returns the xfrm element.
*/
const ensureTransform = (shape, kind) => {
	if (kind === "graphicFrame") {
		let xfrm = firstChildElement(shape, NAME_P_XFRM$1);
		if (xfrm === null) {
			xfrm = elem(NAME_P_XFRM$1);
			const idx = shape.children.findIndex((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "nvGraphicFramePr");
			shape.children.splice(idx + 1, 0, xfrm);
		}
		return xfrm;
	}
	const hostName = kind === "group" ? NAME_GRP_SP_PR$3 : NAME_SP_PR$6;
	let host = firstChildElement(shape, hostName);
	if (host === null) {
		host = elem(hostName);
		shape.children.push(host);
	}
	let xfrm = firstChildElement(host, NAME_A_XFRM$5);
	if (xfrm === null) {
		xfrm = elem(NAME_A_XFRM$5);
		host.children.unshift(xfrm);
	}
	return xfrm;
};
/** Sets the shape's `<a:off>` to `(x, y)` in EMU. */
const setPosition = (shape, kind, x, y) => {
	const xfrm = ensureTransform(shape, kind);
	let off = firstChildElement(xfrm, NAME_OFF$7);
	if (off === null) {
		off = elem(NAME_OFF$7);
		xfrm.children.unshift(off);
	}
	off.attrs = [attr(ATTR_X$7, String(emuCoordinate(x, "setShapePosition: x"))), attr(ATTR_Y$7, String(emuCoordinate(y, "setShapePosition: y")))];
};
/** Sets the shape's `<a:ext>` to `(w, h)` in EMU. */
const setSize = (shape, kind, w, h) => {
	const xfrm = ensureTransform(shape, kind);
	let ext = firstChildElement(xfrm, NAME_EXT$8);
	if (ext === null) {
		ext = elem(NAME_EXT$8);
		const offIdx = xfrm.children.findIndex((c) => c.kind === "element" && c.name.localName === "off" && c.name.namespaceURI === NS.dml);
		if (offIdx >= 0) xfrm.children.splice(offIdx + 1, 0, ext);
		else xfrm.children.push(ext);
	}
	ext.attrs = [attr(ATTR_CX$7, String(emuExtent(w, "setShapeSize: w"))), attr(ATTR_CY$7, String(emuExtent(h, "setShapeSize: h")))];
};
const ATTR_ROT = qname("", "rot", "");
const ATTR_FLIP_H$1 = qname("", "flipH", "");
const ATTR_FLIP_V$1 = qname("", "flipV", "");
/**
* Sets the shape's rotation. `degrees` is degrees (positive clockwise),
* fractional values allowed. PowerPoint serializes the value in
* 60000ths of a degree per ECMA-376 ST_Angle, which we mirror.
*
* The full range is `0..360`; values outside that range are normalized.
*/
const setRotation = (shape, kind, degrees) => {
	const xfrm = ensureTransform(shape, kind);
	const normalized = (degrees % 360 + 360) % 360;
	const value = Math.round(normalized * 6e4);
	xfrm.attrs = xfrm.attrs.filter((a) => a.name.localName !== "rot");
	if (value !== 0) xfrm.attrs.push(attr(ATTR_ROT, String(value)));
};
/** Sets `flipH` / `flipV` boolean attributes on the shape's transform. */
const setFlip = (shape, kind, options) => {
	const xfrm = ensureTransform(shape, kind);
	if (options.horizontal !== void 0) {
		xfrm.attrs = xfrm.attrs.filter((a) => a.name.localName !== "flipH");
		if (options.horizontal) xfrm.attrs.push(attr(ATTR_FLIP_H$1, "1"));
	}
	if (options.vertical !== void 0) {
		xfrm.attrs = xfrm.attrs.filter((a) => a.name.localName !== "flipV");
		if (options.vertical) xfrm.attrs.push(attr(ATTR_FLIP_V$1, "1"));
	}
};
const NAME_PRST_GEOM$4 = qname("a", "prstGeom", NS.dml);
const NAME_AV_LST$4 = qname("a", "avLst", NS.dml);
const NAME_GD = qname("a", "gd", NS.dml);
const ATTR_NAME$12 = qname("", "name", "");
const ATTR_FMLA = qname("", "fmla", "");
/**
* Writes the preset geometry's adjust-handle values (`<a:prstGeom><a:avLst>
* <a:gd name=".." fmla="val N"/></a:avLst>`), replacing any guides already in
* the `<a:avLst>`. Values are the raw ECMA-376 guide numbers and are rounded
* to integers on the way out (guide values are stored as integers). For the
* `roundRect` preset the `adj` guide runs `0..50000` (thousandths of a
* percent of the shorter side; `50000` = fully rounded).
*
* Returns `false` — writing nothing — when the shape carries no
* `<a:prstGeom>` (it uses custom or inherited geometry, so there is no
* adjust list to author). Mirrors `getShapeAdjustValues`, which reads the
* same `val`-form guides.
*/
const setAdjustValues = (shape, values) => {
	const spPr = firstChildElement(shape, NAME_SP_PR$6);
	if (spPr === null) return false;
	const prstGeom = firstChildElement(spPr, NAME_PRST_GEOM$4);
	if (prstGeom === null) return false;
	let avLst = firstChildElement(prstGeom, NAME_AV_LST$4);
	if (avLst === null) {
		avLst = elem(NAME_AV_LST$4);
		prstGeom.children.push(avLst);
	}
	avLst.children = Object.entries(values).map(([name, value]) => elem(NAME_GD, { attrs: [attr(ATTR_NAME$12, name), attr(ATTR_FMLA, `val ${String(Math.round(value))}`)] }));
	return true;
};
//#endregion
//#region src/internal/presentationml/slide-part.ts
const NAME_CSLD$4 = qname("p", "cSld", NS.pml);
const NAME_SP_TREE$3 = qname("p", "spTree", NS.pml);
const NAME_NV_SP_PR$4 = qname("p", "nvSpPr", NS.pml);
const NAME_NV_PIC_PR$2 = qname("p", "nvPicPr", NS.pml);
const NAME_NV_GRP_SP_PR$3 = qname("p", "nvGrpSpPr", NS.pml);
const NAME_NV_GRAPHIC_FRAME_PR$2 = qname("p", "nvGraphicFramePr", NS.pml);
const NAME_NV_CXN_SP_PR$1 = qname("p", "nvCxnSpPr", NS.pml);
const NAME_C_NV_PR$9 = qname("p", "cNvPr", NS.pml);
const NAME_NV_PR$10 = qname("p", "nvPr", NS.pml);
const NAME_PH$2 = qname("p", "ph", NS.pml);
const NAME_TX_BODY$9 = qname("p", "txBody", NS.pml);
const ATTR_ID$14 = qname("", "id", "");
const ATTR_NAME$11 = qname("", "name", "");
const ATTR_TYPE$4 = qname("", "type", "");
const ATTR_IDX$6 = qname("", "idx", "");
const NV_BY_KIND = {
	shape: NAME_NV_SP_PR$4,
	picture: NAME_NV_PIC_PR$2,
	group: NAME_NV_GRP_SP_PR$3,
	graphicFrame: NAME_NV_GRAPHIC_FRAME_PR$2,
	connector: NAME_NV_CXN_SP_PR$1
};
const classify = (element) => {
	if (element.name.namespaceURI !== NS.pml) return null;
	switch (element.name.localName) {
		case "sp": return "shape";
		case "pic": return "picture";
		case "grpSp": return "group";
		case "graphicFrame": return "graphicFrame";
		case "cxnSp": return "connector";
		default: return null;
	}
};
const extractShape = (element, kind) => {
	const nvContainer = firstChildElement(element, NV_BY_KIND[kind]);
	let id = 0;
	let name = "";
	let placeholderType = null;
	let placeholderIdx = null;
	if (nvContainer !== null) {
		const cNvPr = firstChildElement(nvContainer, NAME_C_NV_PR$9);
		if (cNvPr !== null) {
			const idRaw = getAttrValue(cNvPr, ATTR_ID$14);
			if (idRaw !== null) id = Number.parseInt(idRaw, 10);
			const nameRaw = getAttrValue(cNvPr, ATTR_NAME$11);
			if (nameRaw !== null) name = nameRaw;
		}
		const nvPr = firstChildElement(nvContainer, NAME_NV_PR$10);
		if (nvPr !== null) {
			const ph = firstChildElement(nvPr, NAME_PH$2);
			if (ph !== null) {
				placeholderType = getAttrValue(ph, ATTR_TYPE$4);
				const idxRaw = getAttrValue(ph, ATTR_IDX$6);
				if (idxRaw !== null) placeholderIdx = Number.parseInt(idxRaw, 10);
			}
		}
	}
	let text = "";
	if (kind === "shape") {
		const txBody = firstChildElement(element, NAME_TX_BODY$9);
		if (txBody !== null) text = textBodyText(txBody);
	}
	return {
		kind,
		id,
		name,
		placeholderType,
		placeholderIdx,
		text,
		element
	};
};
const collectShapes = (spTree, out, recurseIntoGroups) => {
	for (const child of spTree.children) {
		if (child.kind !== "element") continue;
		const kind = classify(child);
		if (kind === null) continue;
		out.push(extractShape(child, kind));
		if (kind === "group" && recurseIntoGroups) collectShapes(child, out, recurseIntoGroups);
	}
};
/**
* Reads the immediate child shapes of a `<p:grpSp>` (group shape)
* without recursing further. Used by `getGroupChildren` on the public
* surface to expose group contents to renderers.
*
* Throws if `element` isn't a `<p:grpSp>`.
*/
const readGroupChildren = (element) => {
	if (element.name.namespaceURI !== NS.pml || element.name.localName !== "grpSp") throw new Error(`readGroupChildren: expected <p:grpSp>, got <${element.name.prefix}:${element.name.localName}>`);
	const out = [];
	collectShapes(element, out, false);
	return out;
};
/**
* Reads the shape tree from a slide / layout / master root element.
* Exported so the sibling readers (`readSlideLayoutPart`,
* `readSlideMasterPart`) can reuse it.
*/
const readShapeTreeFromCsldRoot = (root, expectedLocalName, options = {}) => {
	if (root.name.namespaceURI !== NS.pml || root.name.localName !== expectedLocalName) throw new Error(`expected <p:${expectedLocalName}>, got <${root.name.prefix}:${root.name.localName}>`);
	const cSld = firstChildElement(root, NAME_CSLD$4);
	if (cSld === null) throw new Error(`<p:${expectedLocalName}>: missing <p:cSld>`);
	const spTree = firstChildElement(cSld, NAME_SP_TREE$3);
	if (spTree === null) throw new Error("<p:cSld>: missing <p:spTree>");
	const shapes = [];
	collectShapes(spTree, shapes, options.recurseIntoGroups ?? true);
	return {
		shapes,
		cSld
	};
};
/**
* Parses a slide root element (`p:sld`) into the typed view above.
*
* `recurseIntoGroups` controls whether group descendants are flattened into
* the returned `shapes` array. The default is `true` because most callers
* just want a flat enumeration.
*/
const readSlidePart = (root, options = {}) => {
	const { shapes } = readShapeTreeFromCsldRoot(root, "sld", options);
	return {
		shapes,
		root
	};
};
/**
* Returns the concatenated visible text of a slide. Useful for snapshot
* tests and quick inspection.
*/
const slideText = (slide, joiner = "\n") => slide.shapes.map((s) => s.text).filter((t) => t.length > 0).join(joiner);
//#endregion
//#region src/internal/presentationml/slide-layout-part.ts
const NAME_CSLD$3 = qname("p", "cSld", NS.pml);
const ATTR_NAME$10 = qname("", "name", "");
const ATTR_TYPE$3 = qname("", "type", "");
/** Parses a `<p:sldLayout>` root element. */
const readSlideLayoutPart = (root, options = {}) => {
	const { shapes } = readShapeTreeFromCsldRoot(root, "sldLayout", options);
	const cSld = firstChildElement(root, NAME_CSLD$3);
	const name = cSld !== null ? getAttrValue(cSld, ATTR_NAME$10) : null;
	const layoutType = getAttrValue(root, ATTR_TYPE$3);
	return {
		name: name ?? "",
		layoutType,
		shapes,
		root
	};
};
//#endregion
//#region src/internal/presentationml/slide-builder.ts
const NAME_SLD = qname("p", "sld", NS.pml);
const NAME_CSLD$2 = qname("p", "cSld", NS.pml);
const NAME_SP_TREE$2 = qname("p", "spTree", NS.pml);
const NAME_NV_GRP_SP_PR$2 = qname("p", "nvGrpSpPr", NS.pml);
const NAME_C_NV_PR$8 = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_GRP_SP_PR$2 = qname("p", "cNvGrpSpPr", NS.pml);
const NAME_NV_PR$9 = qname("p", "nvPr", NS.pml);
const NAME_GRP_SP_PR$2 = qname("p", "grpSpPr", NS.pml);
const NAME_SP$3 = qname("p", "sp", NS.pml);
const NAME_NV_SP_PR$3 = qname("p", "nvSpPr", NS.pml);
const NAME_C_NV_SP_PR$3 = qname("p", "cNvSpPr", NS.pml);
const NAME_SP_PR$5 = qname("p", "spPr", NS.pml);
const NAME_TX_BODY$8 = qname("p", "txBody", NS.pml);
const NAME_PH$1 = qname("p", "ph", NS.pml);
const NAME_BODY_PR$4 = qname("a", "bodyPr", NS.dml);
const NAME_LST_STYLE$4 = qname("a", "lstStyle", NS.dml);
const NAME_P$4 = qname("a", "p", NS.dml);
const NAME_SP_LOCKS$1 = qname("a", "spLocks", NS.dml);
const ATTR_ID$13 = qname("", "id", "");
const ATTR_NAME$9 = qname("", "name", "");
const ATTR_TYPE$2 = qname("", "type", "");
const ATTR_IDX$5 = qname("", "idx", "");
const ATTR_NO_GRP$2 = qname("", "noGrp", "");
/**
* Builds a `<p:sld>` document containing the canonical slide-root group
* (id=1, name="") and one placeholder stub per `<p:ph>` found on
* `layoutSpTree`.
*
* The stubs reuse the layout's `<p:ph>` idx/type attributes verbatim, and
* the names follow PowerPoint's `"Title 1"`, `"Content Placeholder 2"`
* convention based on the placeholder type and an incrementing index.
*/
const buildSlideFromLayout = (layoutSpTree) => {
	const placeholders = [];
	for (const child of layoutSpTree.children) {
		if (child.kind !== "element") continue;
		if (child.name.namespaceURI !== NS.pml || child.name.localName !== "sp") continue;
		const nvSpPr = firstChildElement(child, NAME_NV_SP_PR$3);
		if (nvSpPr === null) continue;
		const nvPr = firstChildElement(nvSpPr, NAME_NV_PR$9);
		if (nvPr === null) continue;
		const ph = firstChildElement(nvPr, NAME_PH$1);
		if (ph === null) continue;
		placeholders.push({
			type: getAttrValue(ph, ATTR_TYPE$2),
			idx: getAttrValue(ph, ATTR_IDX$5)
		});
	}
	let nextShapeId = 2;
	const stubs = [];
	for (const ph of placeholders) {
		stubs.push(buildPlaceholderStub(nextShapeId, ph.type, ph.idx));
		nextShapeId++;
	}
	const cSld = elem(NAME_CSLD$2, { children: [elem(NAME_SP_TREE$2, { children: [
		buildNvGrpSpPr(1),
		buildGrpSpPr(),
		...stubs
	] })] });
	return {
		kind: "document",
		decl: {
			version: "1.0",
			encoding: "UTF-8",
			standalone: "yes"
		},
		prolog: [],
		root: elem(NAME_SLD, {
			prefixDecls: new Map([
				["a", NS.dml],
				["r", NS.officeDocRels],
				["p", NS.pml]
			]),
			children: [cSld]
		}),
		epilog: []
	};
};
const buildNvGrpSpPr = (id) => elem(NAME_NV_GRP_SP_PR$2, { children: [
	elem(NAME_C_NV_PR$8, { attrs: [attr(ATTR_ID$13, String(id)), attr(ATTR_NAME$9, "")] }),
	elem(NAME_C_NV_GRP_SP_PR$2),
	elem(NAME_NV_PR$9)
] });
const buildGrpSpPr = () => elem(NAME_GRP_SP_PR$2);
const buildPlaceholderStub = (id, phType, phIdx) => {
	const phAttrs = [];
	if (phType !== null) phAttrs.push(attr(ATTR_TYPE$2, phType));
	if (phIdx !== null) phAttrs.push(attr(ATTR_IDX$5, phIdx));
	const nvPr = elem(NAME_NV_PR$9, { children: [elem(NAME_PH$1, { attrs: phAttrs })] });
	const cNvSpPr = elem(NAME_C_NV_SP_PR$3, { children: [elem(NAME_SP_LOCKS$1, { attrs: [attr(ATTR_NO_GRP$2, "1")] })] });
	const name = inferPlaceholderName(id, phType);
	return elem(NAME_SP$3, { children: [
		elem(NAME_NV_SP_PR$3, { children: [
			elem(NAME_C_NV_PR$8, { attrs: [attr(ATTR_ID$13, String(id)), attr(ATTR_NAME$9, name)] }),
			cNvSpPr,
			nvPr
		] }),
		elem(NAME_SP_PR$5),
		elem(NAME_TX_BODY$8, { children: [
			elem(NAME_BODY_PR$4),
			elem(NAME_LST_STYLE$4),
			elem(NAME_P$4, { children: [text("")] })
		] })
	] });
};
/**
* Maps a placeholder type to a human-readable name PowerPoint emits. The
* `id` becomes part of the name to keep them unique within the slide.
*/
const inferPlaceholderName = (id, phType) => {
	switch (phType) {
		case "title": return `Title ${id - 1}`;
		case "ctrTitle": return `Centered Title ${id - 1}`;
		case "subTitle": return `Subtitle ${id - 1}`;
		case "body": return `Content Placeholder ${id - 1}`;
		case "pic": return `Picture Placeholder ${id - 1}`;
		case "chart": return `Chart Placeholder ${id - 1}`;
		case "tbl": return `Table Placeholder ${id - 1}`;
		case "dt": return `Date Placeholder ${id - 1}`;
		case "sldNum": return `Slide Number Placeholder ${id - 1}`;
		case "ftr": return `Footer Placeholder ${id - 1}`;
		case "hdr": return `Header Placeholder ${id - 1}`;
		default: return `Placeholder ${id - 1}`;
	}
};
//#endregion
//#region src/internal/presentationml/text-box-builder.ts
const NAME_SP$2 = qname("p", "sp", NS.pml);
const NAME_NV_SP_PR$2 = qname("p", "nvSpPr", NS.pml);
const NAME_C_NV_PR$7 = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_SP_PR$2 = qname("p", "cNvSpPr", NS.pml);
const NAME_NV_PR$8 = qname("p", "nvPr", NS.pml);
const NAME_SP_PR$4 = qname("p", "spPr", NS.pml);
const NAME_TX_BODY$7 = qname("p", "txBody", NS.pml);
const NAME_A_XFRM$4 = qname("a", "xfrm", NS.dml);
const NAME_OFF$6 = qname("a", "off", NS.dml);
const NAME_EXT$7 = qname("a", "ext", NS.dml);
const NAME_PRST_GEOM$3 = qname("a", "prstGeom", NS.dml);
const NAME_AV_LST$3 = qname("a", "avLst", NS.dml);
const NAME_NO_FILL = qname("a", "noFill", NS.dml);
const NAME_BODY_PR$3 = qname("a", "bodyPr", NS.dml);
const NAME_LST_STYLE$3 = qname("a", "lstStyle", NS.dml);
const NAME_P$3 = qname("a", "p", NS.dml);
const NAME_R$3 = qname("a", "r", NS.dml);
const NAME_RPR$3 = qname("a", "rPr", NS.dml);
const NAME_T$4 = qname("a", "t", NS.dml);
const ATTR_ID$12 = qname("", "id", "");
const ATTR_NAME$8 = qname("", "name", "");
const ATTR_TX_BOX$1 = qname("", "txBox", "");
const ATTR_X$6 = qname("", "x", "");
const ATTR_Y$6 = qname("", "y", "");
const ATTR_CX$6 = qname("", "cx", "");
const ATTR_CY$6 = qname("", "cy", "");
const ATTR_PRST$3 = qname("", "prst", "");
const ATTR_WRAP$1 = qname("", "wrap", "");
const ATTR_RTL_COL$1 = qname("", "rtlCol", "");
const ATTR_LANG$3 = qname("", "lang", "");
NS.xml;
/**
* Returns a `<p:sp>` element representing a text-box shape positioned at
* `(x, y)` with extent `(w, h)`. The shape carries a `txBox="1"` marker
* and a `prstGeom prst="rect"` so PowerPoint renders it as a plain text
* frame without fill or outline.
*/
const buildTextBox = (opts) => {
	const name = opts.name ?? `TextBox ${opts.id}`;
	const nvSpPr = elem(NAME_NV_SP_PR$2, { children: [
		elem(NAME_C_NV_PR$7, { attrs: [attr(ATTR_ID$12, String(opts.id)), attr(ATTR_NAME$8, name)] }),
		elem(NAME_C_NV_SP_PR$2, { attrs: [attr(ATTR_TX_BOX$1, "1")] }),
		elem(NAME_NV_PR$8)
	] });
	const spPr = elem(NAME_SP_PR$4, { children: [
		elem(NAME_A_XFRM$4, { children: [elem(NAME_OFF$6, { attrs: [attr(ATTR_X$6, String(emuCoordinate(opts.x, "addSlideTextBox: x"))), attr(ATTR_Y$6, String(emuCoordinate(opts.y, "addSlideTextBox: y")))] }), elem(NAME_EXT$7, { attrs: [attr(ATTR_CX$6, String(emuExtent(opts.w, "addSlideTextBox: w"))), attr(ATTR_CY$6, String(emuExtent(opts.h, "addSlideTextBox: h")))] })] }),
		elem(NAME_PRST_GEOM$3, {
			attrs: [attr(ATTR_PRST$3, "rect")],
			children: [elem(NAME_AV_LST$3)]
		}),
		elem(NAME_NO_FILL)
	] });
	const paragraphs = opts.text.split("\n").map((line) => {
		const t = elem(NAME_T$4, { children: line.length > 0 ? [text(line)] : [] });
		return elem(NAME_P$3, { children: [elem(NAME_R$3, { children: [elem(NAME_RPR$3, { attrs: [attr(ATTR_LANG$3, "en-US")] }), t] })] });
	});
	return elem(NAME_SP$2, { children: [
		nvSpPr,
		spPr,
		elem(NAME_TX_BODY$7, { children: [
			elem(NAME_BODY_PR$3, { attrs: [attr(ATTR_WRAP$1, "square"), attr(ATTR_RTL_COL$1, "0")] }),
			elem(NAME_LST_STYLE$3),
			...paragraphs
		] })
	] });
};
//#endregion
//#region src/internal/presentationml/shape-builder.ts
const NAME_SP$1 = qname("p", "sp", NS.pml);
const NAME_NV_SP_PR$1 = qname("p", "nvSpPr", NS.pml);
const NAME_C_NV_PR$6 = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_SP_PR$1 = qname("p", "cNvSpPr", NS.pml);
const NAME_NV_PR$7 = qname("p", "nvPr", NS.pml);
const NAME_SP_PR$3 = qname("p", "spPr", NS.pml);
const NAME_TX_BODY$6 = qname("p", "txBody", NS.pml);
const NAME_A_XFRM$3 = qname("a", "xfrm", NS.dml);
const NAME_OFF$5 = qname("a", "off", NS.dml);
const NAME_EXT$6 = qname("a", "ext", NS.dml);
const NAME_PRST_GEOM$2 = qname("a", "prstGeom", NS.dml);
const NAME_AV_LST$2 = qname("a", "avLst", NS.dml);
const NAME_BODY_PR$2 = qname("a", "bodyPr", NS.dml);
const NAME_LST_STYLE$2 = qname("a", "lstStyle", NS.dml);
const NAME_P$2 = qname("a", "p", NS.dml);
const NAME_R$2 = qname("a", "r", NS.dml);
const NAME_RPR$2 = qname("a", "rPr", NS.dml);
const NAME_T$3 = qname("a", "t", NS.dml);
const ATTR_ID$11 = qname("", "id", "");
const ATTR_NAME$7 = qname("", "name", "");
const ATTR_X$5 = qname("", "x", "");
const ATTR_Y$5 = qname("", "y", "");
const ATTR_CX$5 = qname("", "cx", "");
const ATTR_CY$5 = qname("", "cy", "");
const ATTR_PRST$2 = qname("", "prst", "");
const ATTR_WRAP = qname("", "wrap", "");
const ATTR_RTL_COL = qname("", "rtlCol", "");
const ATTR_LANG$2 = qname("", "lang", "");
const ATTR_ANCHOR = qname("", "anchor", "");
const ATTR_ANCHOR_CTR = qname("", "anchorCtr", "");
const buildTextBody = (text$1, anchor) => {
	if (text$1 === void 0) return null;
	const bodyPrAttrs = [attr(ATTR_WRAP, "square"), attr(ATTR_RTL_COL, "0")];
	if (anchor === "ctr" || anchor === "t" || anchor === "b") bodyPrAttrs.push(attr(ATTR_ANCHOR, anchor));
	if (anchor === "ctr" || anchor === void 0) bodyPrAttrs.push(attr(ATTR_ANCHOR_CTR, "1"));
	const bodyPr = elem(NAME_BODY_PR$2, { attrs: bodyPrAttrs });
	const paragraphs = text$1.split("\n").map((line) => {
		const t = elem(NAME_T$3, { children: line.length > 0 ? [text(line)] : [] });
		return elem(NAME_P$2, { children: [elem(NAME_R$2, { children: [elem(NAME_RPR$2, { attrs: [attr(ATTR_LANG$2, "en-US")] }), t] })] });
	});
	return elem(NAME_TX_BODY$6, { children: [
		bodyPr,
		elem(NAME_LST_STYLE$2),
		...paragraphs
	] });
};
const buildShape = (opts) => {
	oneOf(opts.preset, SHAPE_PRESETS, "addSlideShape: preset");
	if (opts.textAnchor !== void 0) oneOf(opts.textAnchor, [
		"t",
		"ctr",
		"b"
	], "addSlideShape: textAnchor");
	const name = opts.name ?? `${opts.preset} ${opts.id}`;
	const anchor = opts.textAnchor ?? "ctr";
	const children = [elem(NAME_NV_SP_PR$1, { children: [
		elem(NAME_C_NV_PR$6, { attrs: [attr(ATTR_ID$11, String(opts.id)), attr(ATTR_NAME$7, name)] }),
		elem(NAME_C_NV_SP_PR$1),
		elem(NAME_NV_PR$7)
	] }), elem(NAME_SP_PR$3, { children: [elem(NAME_A_XFRM$3, { children: [elem(NAME_OFF$5, { attrs: [attr(ATTR_X$5, String(emuCoordinate(opts.x, "addSlideShape: x"))), attr(ATTR_Y$5, String(emuCoordinate(opts.y, "addSlideShape: y")))] }), elem(NAME_EXT$6, { attrs: [attr(ATTR_CX$5, String(emuExtent(opts.w, "addSlideShape: w"))), attr(ATTR_CY$5, String(emuExtent(opts.h, "addSlideShape: h")))] })] }), elem(NAME_PRST_GEOM$2, {
		attrs: [attr(ATTR_PRST$2, opts.preset)],
		children: [elem(NAME_AV_LST$2)]
	})] })];
	const txBody = buildTextBody(opts.text, anchor);
	if (txBody) children.push(txBody);
	return elem(NAME_SP$1, { children });
};
//#endregion
//#region src/internal/presentationml/connector-builder.ts
const NAME_CXN_SP = qname("p", "cxnSp", NS.pml);
const NAME_NV_CXN_SP_PR = qname("p", "nvCxnSpPr", NS.pml);
const NAME_C_NV_PR$5 = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_CXN_SP_PR = qname("p", "cNvCxnSpPr", NS.pml);
const NAME_NV_PR$6 = qname("p", "nvPr", NS.pml);
const NAME_SP_PR$2 = qname("p", "spPr", NS.pml);
const NAME_A_XFRM$2 = qname("a", "xfrm", NS.dml);
const NAME_OFF$4 = qname("a", "off", NS.dml);
const NAME_EXT$5 = qname("a", "ext", NS.dml);
const NAME_PRST_GEOM$1 = qname("a", "prstGeom", NS.dml);
const NAME_AV_LST$1 = qname("a", "avLst", NS.dml);
const NAME_LN = qname("a", "ln", NS.dml);
const NAME_SOLID_FILL$3 = qname("a", "solidFill", NS.dml);
const NAME_STYLE = qname("p", "style", NS.pml);
const NAME_LN_REF = qname("a", "lnRef", NS.dml);
const NAME_FILL_REF = qname("a", "fillRef", NS.dml);
const NAME_EFFECT_REF = qname("a", "effectRef", NS.dml);
const NAME_FONT_REF = qname("a", "fontRef", NS.dml);
const NAME_SCHEME_CLR = qname("a", "schemeClr", NS.dml);
const ATTR_IDX$4 = qname("", "idx", "");
const ATTR_VAL$5 = qname("", "val", "");
const ATTR_ID$10 = qname("", "id", "");
const ATTR_NAME$6 = qname("", "name", "");
const ATTR_X$4 = qname("", "x", "");
const ATTR_Y$4 = qname("", "y", "");
const ATTR_CX$4 = qname("", "cx", "");
const ATTR_CY$4 = qname("", "cy", "");
const ATTR_PRST$1 = qname("", "prst", "");
const ATTR_W$1 = qname("", "w", "");
const ATTR_FLIP_H = qname("", "flipH", "");
const ATTR_FLIP_V = qname("", "flipV", "");
/** Returns a `<p:cxnSp>` straight-line connector. */
const buildConnector = (opts) => {
	const name = opts.name ?? `Straight Connector ${opts.id}`;
	const nvCxnSpPr = elem(NAME_NV_CXN_SP_PR, { children: [
		elem(NAME_C_NV_PR$5, { attrs: [attr(ATTR_ID$10, String(opts.id)), attr(ATTR_NAME$6, name)] }),
		elem(NAME_C_NV_CXN_SP_PR),
		elem(NAME_NV_PR$6)
	] });
	const x = Math.min(opts.from.x, opts.to.x);
	const y = Math.min(opts.from.y, opts.to.y);
	const cx = Math.abs(opts.to.x - opts.from.x);
	const cy = Math.abs(opts.to.y - opts.from.y);
	const flipH = opts.from.x > opts.to.x;
	const flipV = opts.from.y > opts.to.y;
	const xfrmAttrs = [];
	if (flipH) xfrmAttrs.push(attr(ATTR_FLIP_H, "1"));
	if (flipV) xfrmAttrs.push(attr(ATTR_FLIP_V, "1"));
	const xfrm = elem(NAME_A_XFRM$2, {
		attrs: xfrmAttrs,
		children: [elem(NAME_OFF$4, { attrs: [attr(ATTR_X$4, String(emuCoordinate(x, "addSlideLine: x"))), attr(ATTR_Y$4, String(emuCoordinate(y, "addSlideLine: y")))] }), elem(NAME_EXT$5, { attrs: [attr(ATTR_CX$4, String(emuExtent(cx, "addSlideLine: width"))), attr(ATTR_CY$4, String(emuExtent(cy, "addSlideLine: height")))] })]
	});
	const prstGeom = elem(NAME_PRST_GEOM$1, {
		attrs: [attr(ATTR_PRST$1, "line")],
		children: [elem(NAME_AV_LST$1)]
	});
	const hasExplicitLine = opts.color !== void 0 || opts.widthEmu !== void 0;
	const spPrChildren = [xfrm, prstGeom];
	if (hasExplicitLine) {
		const ln = elem(NAME_LN, {
			attrs: opts.widthEmu !== void 0 ? [attr(ATTR_W$1, String(lineWidthEmu(opts.widthEmu, "addSlideLine: widthEmu")))] : [],
			children: opts.color !== void 0 ? [elem(NAME_SOLID_FILL$3, { children: [buildColorElement(opts.color)] })] : []
		});
		spPrChildren.push(ln);
	}
	const children = [nvCxnSpPr, elem(NAME_SP_PR$2, { children: spPrChildren })];
	if (!hasExplicitLine) {
		const styleRef = (name, idx, clr) => elem(name, {
			attrs: [attr(ATTR_IDX$4, idx)],
			children: [elem(NAME_SCHEME_CLR, { attrs: [attr(ATTR_VAL$5, clr)] })]
		});
		children.push(elem(NAME_STYLE, { children: [
			styleRef(NAME_LN_REF, "1", "accent1"),
			styleRef(NAME_FILL_REF, "0", "accent1"),
			styleRef(NAME_EFFECT_REF, "0", "accent1"),
			styleRef(NAME_FONT_REF, "minor", "tx1")
		] }));
	}
	return elem(NAME_CXN_SP, { children });
};
//#endregion
//#region src/internal/presentationml/group-builder.ts
const NAME_GRP_SP = qname("p", "grpSp", NS.pml);
const NAME_NV_GRP_SP_PR$1 = qname("p", "nvGrpSpPr", NS.pml);
const NAME_C_NV_PR$4 = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_GRP_SP_PR$1 = qname("p", "cNvGrpSpPr", NS.pml);
const NAME_NV_PR$5 = qname("p", "nvPr", NS.pml);
const NAME_GRP_SP_PR$1 = qname("p", "grpSpPr", NS.pml);
const NAME_A_XFRM$1 = qname("a", "xfrm", NS.dml);
const NAME_OFF$3 = qname("a", "off", NS.dml);
const NAME_EXT$4 = qname("a", "ext", NS.dml);
const NAME_CH_OFF = qname("a", "chOff", NS.dml);
const NAME_CH_EXT = qname("a", "chExt", NS.dml);
const ATTR_ID$9 = qname("", "id", "");
const ATTR_NAME$5 = qname("", "name", "");
const ATTR_X$3 = qname("", "x", "");
const ATTR_Y$3 = qname("", "y", "");
const ATTR_CX$3 = qname("", "cx", "");
const ATTR_CY$3 = qname("", "cy", "");
/** Returns a `<p:grpSp>` wrapping `opts.children` under one transform. */
const buildGroup = (opts) => {
	const name = opts.name ?? `Group ${opts.id}`;
	const nvGrpSpPr = elem(NAME_NV_GRP_SP_PR$1, { children: [
		elem(NAME_C_NV_PR$4, { attrs: [attr(ATTR_ID$9, String(opts.id)), attr(ATTR_NAME$5, name)] }),
		elem(NAME_C_NV_GRP_SP_PR$1),
		elem(NAME_NV_PR$5)
	] });
	const x = emuCoordinate(opts.x, "groupShapes: x");
	const y = emuCoordinate(opts.y, "groupShapes: y");
	const cx = emuExtent(opts.w, "groupShapes: w");
	const cy = emuExtent(opts.h, "groupShapes: h");
	return elem(NAME_GRP_SP, { children: [
		nvGrpSpPr,
		elem(NAME_GRP_SP_PR$1, { children: [elem(NAME_A_XFRM$1, { children: [
			elem(NAME_OFF$3, { attrs: [attr(ATTR_X$3, String(x)), attr(ATTR_Y$3, String(y))] }),
			elem(NAME_EXT$4, { attrs: [attr(ATTR_CX$3, String(cx)), attr(ATTR_CY$3, String(cy))] }),
			elem(NAME_CH_OFF, { attrs: [attr(ATTR_X$3, String(x)), attr(ATTR_Y$3, String(y))] }),
			elem(NAME_CH_EXT, { attrs: [attr(ATTR_CX$3, String(cx)), attr(ATTR_CY$3, String(cy))] })
		] })] }),
		...opts.children
	] });
};
//#endregion
//#region src/internal/presentationml/picture-builder.ts
const NAME_PIC = qname("p", "pic", NS.pml);
const NAME_NV_PIC_PR$1 = qname("p", "nvPicPr", NS.pml);
const NAME_C_NV_PR$3 = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_PIC_PR = qname("p", "cNvPicPr", NS.pml);
const NAME_NV_PR$4 = qname("p", "nvPr", NS.pml);
const NAME_BLIP_FILL = qname("p", "blipFill", NS.pml);
const NAME_BLIP = qname("a", "blip", NS.dml);
const NAME_STRETCH = qname("a", "stretch", NS.dml);
const NAME_FILL_RECT = qname("a", "fillRect", NS.dml);
const NAME_SP_PR$1 = qname("p", "spPr", NS.pml);
const NAME_A_XFRM = qname("a", "xfrm", NS.dml);
const NAME_OFF$2 = qname("a", "off", NS.dml);
const NAME_EXT$3 = qname("a", "ext", NS.dml);
const NAME_PRST_GEOM = qname("a", "prstGeom", NS.dml);
const NAME_AV_LST = qname("a", "avLst", NS.dml);
const NAME_PIC_LOCKS = qname("a", "picLocks", NS.dml);
const ATTR_ID$8 = qname("", "id", "");
const ATTR_NAME$4 = qname("", "name", "");
const ATTR_X$2 = qname("", "x", "");
const ATTR_Y$2 = qname("", "y", "");
const ATTR_CX$2 = qname("", "cx", "");
const ATTR_CY$2 = qname("", "cy", "");
const ATTR_PRST = qname("", "prst", "");
const ATTR_R_EMBED$1 = qname("r", "embed", NS.officeDocRels);
const ATTR_NO_CHANGE_ASPECT$1 = qname("", "noChangeAspect", "");
/** Returns a `<p:pic>` element ready to be appended to a slide's `<p:spTree>`. */
const buildPicture = (opts) => {
	const name = opts.name ?? `Picture ${opts.id}`;
	const cNvPicPr = elem(NAME_C_NV_PIC_PR, { children: [elem(NAME_PIC_LOCKS, { attrs: opts.lockAspect ?? true ? [attr(ATTR_NO_CHANGE_ASPECT$1, "1")] : [] })] });
	return elem(NAME_PIC, { children: [
		elem(NAME_NV_PIC_PR$1, { children: [
			elem(NAME_C_NV_PR$3, { attrs: [attr(ATTR_ID$8, String(opts.id)), attr(ATTR_NAME$4, name)] }),
			cNvPicPr,
			elem(NAME_NV_PR$4)
		] }),
		elem(NAME_BLIP_FILL, { children: [elem(NAME_BLIP, { attrs: [attr(ATTR_R_EMBED$1, opts.rEmbed)] }), elem(NAME_STRETCH, { children: [elem(NAME_FILL_RECT)] })] }),
		elem(NAME_SP_PR$1, { children: [elem(NAME_A_XFRM, { children: [elem(NAME_OFF$2, { attrs: [attr(ATTR_X$2, String(emuCoordinate(opts.x, "addSlideImage: x"))), attr(ATTR_Y$2, String(emuCoordinate(opts.y, "addSlideImage: y")))] }), elem(NAME_EXT$3, { attrs: [attr(ATTR_CX$2, String(emuExtent(opts.w, "addSlideImage: w"))), attr(ATTR_CY$2, String(emuExtent(opts.h, "addSlideImage: h")))] })] }), elem(NAME_PRST_GEOM, {
			attrs: [attr(ATTR_PRST, "rect")],
			children: [elem(NAME_AV_LST)]
		})] })
	] });
};
//#endregion
//#region src/internal/presentationml/media-builder.ts
const NAME_NV_PIC_PR = qname("p", "nvPicPr", NS.pml);
const NAME_C_NV_PR$2 = qname("p", "cNvPr", NS.pml);
const NAME_NV_PR$3 = qname("p", "nvPr", NS.pml);
const NAME_HLINK_CLICK = qname("a", "hlinkClick", NS.dml);
const NAME_VIDEO_FILE = qname("a", "videoFile", NS.dml);
const NAME_AUDIO_FILE = qname("a", "audioFile", NS.dml);
const NAME_EXT_LST$2 = qname("p", "extLst", NS.pml);
const NAME_EXT$2 = qname("p", "ext", NS.pml);
const NAME_P14_MEDIA = qname("p14", "media", NS.p14);
const NAME_TIMING$2 = qname("p", "timing", NS.pml);
const NAME_TN_LST$2 = qname("p", "tnLst", NS.pml);
const NAME_PAR$2 = qname("p", "par", NS.pml);
const NAME_C_TN$2 = qname("p", "cTn", NS.pml);
const NAME_CHILD_TN_LST$2 = qname("p", "childTnLst", NS.pml);
const NAME_VIDEO = qname("p", "video", NS.pml);
const NAME_AUDIO = qname("p", "audio", NS.pml);
const NAME_C_MEDIA_NODE = qname("p", "cMediaNode", NS.pml);
const NAME_ST_COND_LST$1 = qname("p", "stCondLst", NS.pml);
const NAME_COND$1 = qname("p", "cond", NS.pml);
const NAME_TGT_EL$1 = qname("p", "tgtEl", NS.pml);
const NAME_SP_TGT$1 = qname("p", "spTgt", NS.pml);
const ATTR_R_ID$2 = qname("r", "id", NS.officeDocRels);
const ATTR_R_LINK = qname("r", "link", NS.officeDocRels);
const ATTR_R_EMBED = qname("r", "embed", NS.officeDocRels);
const ATTR_ACTION = qname("", "action", "");
const ATTR_URI$2 = qname("", "uri", "");
const ATTR_ID$7 = qname("", "id", "");
const ATTR_DUR$1 = qname("", "dur", "");
const ATTR_RESTART$1 = qname("", "restart", "");
const ATTR_NODE_TYPE$1 = qname("", "nodeType", "");
const ATTR_VOL = qname("", "vol", "");
const ATTR_FILL$1 = qname("", "fill", "");
const ATTR_DISPLAY = qname("", "display", "");
const ATTR_DELAY$1 = qname("", "delay", "");
const ATTR_SPID$1 = qname("", "spid", "");
const MEDIA_ACTION = "ppaction://media";
const P14_MEDIA_EXT_URI = "{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}";
const DEFAULT_MEDIA_VOLUME = "80000";
/** Returns a media `<p:pic>`; `opts.rEmbed` is the poster image relationship. */
const buildMediaPicture = (opts) => {
	const pic = buildPicture(opts);
	const nvPicPr = firstChildElement(pic, NAME_NV_PIC_PR);
	const cNvPr = firstChildElement(nvPicPr, NAME_C_NV_PR$2);
	const nvPr = firstChildElement(nvPicPr, NAME_NV_PR$3);
	cNvPr.children.push(elem(NAME_HLINK_CLICK, { attrs: [attr(ATTR_R_ID$2, ""), attr(ATTR_ACTION, MEDIA_ACTION)] }));
	nvPr.children.push(elem(opts.kind === "video" ? NAME_VIDEO_FILE : NAME_AUDIO_FILE, { attrs: [attr(ATTR_R_LINK, opts.rLink)] }));
	if (opts.rMedia !== void 0) {
		const media = elem(NAME_P14_MEDIA, {
			attrs: [attr(ATTR_R_EMBED, opts.rMedia)],
			prefixDecls: new Map([["p14", NS.p14]])
		});
		const ext = elem(NAME_EXT$2, {
			attrs: [attr(ATTR_URI$2, P14_MEDIA_EXT_URI)],
			children: [media]
		});
		nvPr.children.push(elem(NAME_EXT_LST$2, { children: [ext] }));
	}
	return pic;
};
/** Returns the `<p:video>` / `<p:audio>` time node that targets shape `spid`. */
const buildMediaTimingNode = (kind, spid, cTnId) => {
	const cTn = elem(NAME_C_TN$2, {
		attrs: [
			attr(ATTR_ID$7, String(cTnId)),
			attr(ATTR_FILL$1, "hold"),
			attr(ATTR_DISPLAY, "0")
		],
		children: [elem(NAME_ST_COND_LST$1, { children: [elem(NAME_COND$1, { attrs: [attr(ATTR_DELAY$1, "indefinite")] })] })]
	});
	const tgtEl = elem(NAME_TGT_EL$1, { children: [elem(NAME_SP_TGT$1, { attrs: [attr(ATTR_SPID$1, String(spid))] })] });
	const cMediaNode = elem(NAME_C_MEDIA_NODE, {
		attrs: [attr(ATTR_VOL, DEFAULT_MEDIA_VOLUME)],
		children: [cTn, tgtEl]
	});
	return elem(kind === "video" ? NAME_VIDEO : NAME_AUDIO, { children: [cMediaNode] });
};
/**
* Returns a `<p:timing>` holding only the root time node, with `nodes` as its
* children. `nodes` must be non-empty (`<p:childTnLst>` requires a child).
*/
const buildTimingRoot = (nodes) => {
	return elem(NAME_TIMING$2, { children: [elem(NAME_TN_LST$2, { children: [elem(NAME_PAR$2, { children: [elem(NAME_C_TN$2, {
		attrs: [
			attr(ATTR_ID$7, "1"),
			attr(ATTR_DUR$1, "indefinite"),
			attr(ATTR_RESTART$1, "never"),
			attr(ATTR_NODE_TYPE$1, "tmRoot")
		],
		children: [elem(NAME_CHILD_TN_LST$2, { children: [...nodes] })]
	})] })] })] });
};
/** `true` for a `<p:video>` / `<p:audio>` time node. */
const isMediaTimingNode = (el) => el.name.namespaceURI === NS.pml && (el.name.localName === "video" || el.name.localName === "audio");
/** Shape id a media time node targets, or `null` when it has no `<p:spTgt>`. */
const mediaTimingNodeTarget = (node) => {
	const cMediaNode = firstChildElement(node, NAME_C_MEDIA_NODE);
	const tgtEl = cMediaNode ? firstChildElement(cMediaNode, NAME_TGT_EL$1) : null;
	const spTgt = tgtEl ? firstChildElement(tgtEl, NAME_SP_TGT$1) : null;
	const raw = spTgt ? getAttrValue(spTgt, ATTR_SPID$1) : null;
	if (raw === null) return null;
	const spid = Number.parseInt(raw, 10);
	return Number.isFinite(spid) ? spid : null;
};
const MEDIA_FILE_ELEMENTS = {
	videoFile: "video",
	quickTimeFile: "video",
	audioFile: "audio",
	wavAudioFile: "audio"
};
/** Reads the media reference off a `<p:pic>`, or `null` for a plain picture. */
const readPictureMediaRef = (pic) => {
	const nvPicPr = firstChildElement(pic, NAME_NV_PIC_PR);
	const nvPr = nvPicPr ? firstChildElement(nvPicPr, NAME_NV_PR$3) : null;
	if (!nvPr) return null;
	for (const child of nvPr.children) {
		if (child.kind !== "element" || child.name.namespaceURI !== NS.dml) continue;
		const kind = MEDIA_FILE_ELEMENTS[child.name.localName];
		if (kind === void 0) continue;
		return {
			kind,
			fileRId: child.name.localName === "wavAudioFile" ? getAttrValue(child, ATTR_R_EMBED) : getAttrValue(child, ATTR_R_LINK),
			mediaRId: readP14MediaRId(nvPr)
		};
	}
	return null;
};
const readP14MediaRId = (nvPr) => {
	const extLst = firstChildElement(nvPr, NAME_EXT_LST$2);
	if (!extLst) return null;
	for (const ext of extLst.children) {
		if (ext.kind !== "element") continue;
		const media = firstChildElement(ext, NAME_P14_MEDIA);
		if (media) return getAttrValue(media, ATTR_R_EMBED);
	}
	return null;
};
//#endregion
//#region src/internal/presentationml/table-builder.ts
const TABLE_URI = "http://schemas.openxmlformats.org/drawingml/2006/table";
const DEFAULT_TABLE_STYLE_ID = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
const NAME_GRAPHIC_FRAME$1 = qname("p", "graphicFrame", NS.pml);
const NAME_NV_GRAPHIC_FRAME_PR$1 = qname("p", "nvGraphicFramePr", NS.pml);
const NAME_C_NV_PR$1 = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_GRAPHIC_FRAME_PR$1 = qname("p", "cNvGraphicFramePr", NS.pml);
const NAME_GRAPHIC_FRAME_LOCKS = qname("a", "graphicFrameLocks", NS.dml);
const NAME_NV_PR$2 = qname("p", "nvPr", NS.pml);
const NAME_P_XFRM = qname("p", "xfrm", NS.pml);
const NAME_OFF$1 = qname("a", "off", NS.dml);
const NAME_EXT$1 = qname("a", "ext", NS.dml);
const NAME_GRAPHIC$1 = qname("a", "graphic", NS.dml);
const NAME_GRAPHIC_DATA$1 = qname("a", "graphicData", NS.dml);
const NAME_TBL = qname("a", "tbl", NS.dml);
const NAME_TBL_PR = qname("a", "tblPr", NS.dml);
const NAME_TABLE_STYLE_ID = qname("a", "tableStyleId", NS.dml);
const NAME_TBL_GRID = qname("a", "tblGrid", NS.dml);
const NAME_GRID_COL = qname("a", "gridCol", NS.dml);
const NAME_TR = qname("a", "tr", NS.dml);
const NAME_TC = qname("a", "tc", NS.dml);
const NAME_TC_PR = qname("a", "tcPr", NS.dml);
const NAME_TX_BODY$5 = qname("a", "txBody", NS.dml);
const NAME_BODY_PR$1 = qname("a", "bodyPr", NS.dml);
const NAME_LST_STYLE$1 = qname("a", "lstStyle", NS.dml);
const NAME_P$1 = qname("a", "p", NS.dml);
const NAME_R$1 = qname("a", "r", NS.dml);
const NAME_RPR$1 = qname("a", "rPr", NS.dml);
const NAME_SOLID_FILL$2 = qname("a", "solidFill", NS.dml);
const NAME_SRGB_CLR$2 = qname("a", "srgbClr", NS.dml);
const NAME_T$2 = qname("a", "t", NS.dml);
const NAME_PPR = qname("a", "pPr", NS.dml);
const NAME_BU_NONE = qname("a", "buNone", NS.dml);
const ATTR_VAL$4 = qname("", "val", "");
const ATTR_MAR_L = qname("", "marL", "");
const ATTR_MAR_R = qname("", "marR", "");
const ATTR_MAR_T = qname("", "marT", "");
const ATTR_MAR_B = qname("", "marB", "");
const ATTR_INDENT = qname("", "indent", "");
const ATTR_ID$6 = qname("", "id", "");
const ATTR_NAME$3 = qname("", "name", "");
const ATTR_NO_GRP$1 = qname("", "noGrp", "");
const ATTR_X$1 = qname("", "x", "");
const ATTR_Y$1 = qname("", "y", "");
const ATTR_CX$1 = qname("", "cx", "");
const ATTR_CY$1 = qname("", "cy", "");
const ATTR_URI$1 = qname("", "uri", "");
const ATTR_W = qname("", "w", "");
const ATTR_H = qname("", "h", "");
const ATTR_FIRST_ROW = qname("", "firstRow", "");
const ATTR_BAND_ROW = qname("", "bandRow", "");
const ATTR_LANG$1 = qname("", "lang", "");
const buildCellRunProps = (textColorHex) => {
	const langAttr = attr(ATTR_LANG$1, "en-US");
	if (textColorHex === void 0) return elem(NAME_RPR$1, { attrs: [langAttr] });
	const solidFill = elem(NAME_SOLID_FILL$2, { children: [elem(NAME_SRGB_CLR$2, { attrs: [attr(ATTR_VAL$4, (textColorHex.startsWith("#") ? textColorHex.slice(1) : textColorHex).toUpperCase())] })] });
	return elem(NAME_RPR$1, {
		attrs: [langAttr],
		children: [solidFill]
	});
};
const buildCellParagraph = (line, textColorHex) => {
	const pPr = elem(NAME_PPR, {
		attrs: [attr(ATTR_MAR_L, "0"), attr(ATTR_INDENT, "0")],
		children: [elem(NAME_BU_NONE)]
	});
	const t = elem(NAME_T$2, { children: line.length > 0 ? [text(line)] : [] });
	return elem(NAME_P$1, { children: [pPr, elem(NAME_R$1, { children: [buildCellRunProps(textColorHex), t] })] });
};
const buildTextCellBody = (value, textColorHex) => {
	const paragraphs = (value.length === 0 ? [""] : value.split("\n")).map((line) => buildCellParagraph(line, textColorHex));
	return elem(NAME_TX_BODY$5, { children: [
		elem(NAME_BODY_PR$1),
		elem(NAME_LST_STYLE$1),
		...paragraphs
	] });
};
const buildCellProps = () => elem(NAME_TC_PR, { attrs: [
	attr(ATTR_MAR_L, "91440"),
	attr(ATTR_MAR_R, "91440"),
	attr(ATTR_MAR_T, "45720"),
	attr(ATTR_MAR_B, "45720")
] });
/** @internal — used by row-mutation paths in the public API. */
const buildTableCell = (value, textColorHex) => {
	return elem(NAME_TC, { children: [buildTextCellBody(value, textColorHex), buildCellProps()] });
};
/** @internal — used by row-mutation paths in the public API. */
const buildTableRow = (cells, h, textColorHex) => elem(NAME_TR, {
	attrs: [attr(ATTR_H, String(emuExtent(h, "addSlideTable: row height")))],
	children: cells.map((value) => buildTableCell(value, textColorHex))
});
const equalShares = (total, n) => {
	if (n <= 0) return [];
	const base = Math.floor(total / n);
	const shares = Array.from({ length: n }, () => base);
	shares[n - 1] = base + (total - base * n);
	return shares;
};
const buildTable = (opts) => {
	const rows = opts.rows;
	if (rows.length === 0) throw new Error("addSlideTable: at least one row is required");
	const colCount = rows[0]?.length ?? 0;
	if (colCount === 0) throw new Error("addSlideTable: at least one column is required");
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		if (!r) throw new Error(`addSlideTable: row ${i} is missing`);
		if (r.length !== colCount) throw new Error(`addSlideTable: row ${i} has ${r.length} cells; expected ${colCount} to match row 0`);
	}
	const colWidths = opts.colWidths ?? equalShares(opts.w, colCount);
	if (colWidths.length !== colCount) throw new Error(`addSlideTable: colWidths has ${colWidths.length} entries; expected ${colCount}`);
	const rowHeights = opts.rowHeights ?? equalShares(opts.h, rows.length);
	if (rowHeights.length !== rows.length) throw new Error(`addSlideTable: rowHeights has ${rowHeights.length} entries; expected ${rows.length}`);
	const name = opts.name ?? `Table ${opts.id}`;
	const nvGraphicFramePr = elem(NAME_NV_GRAPHIC_FRAME_PR$1, { children: [
		elem(NAME_C_NV_PR$1, { attrs: [attr(ATTR_ID$6, String(opts.id)), attr(ATTR_NAME$3, name)] }),
		elem(NAME_C_NV_GRAPHIC_FRAME_PR$1, { children: [elem(NAME_GRAPHIC_FRAME_LOCKS, { attrs: [attr(ATTR_NO_GRP$1, "1")] })] }),
		elem(NAME_NV_PR$2)
	] });
	const xfrm = elem(NAME_P_XFRM, { children: [elem(NAME_OFF$1, { attrs: [attr(ATTR_X$1, String(emuCoordinate(opts.x, "addSlideTable: x"))), attr(ATTR_Y$1, String(emuCoordinate(opts.y, "addSlideTable: y")))] }), elem(NAME_EXT$1, { attrs: [attr(ATTR_CX$1, String(emuExtent(opts.w, "addSlideTable: w"))), attr(ATTR_CY$1, String(emuExtent(opts.h, "addSlideTable: h")))] })] });
	const tableStyleId = elem(NAME_TABLE_STYLE_ID, { children: [text(opts.styleId === void 0 ? DEFAULT_TABLE_STYLE_ID : normalizeGuid(opts.styleId, "addSlideTable: styleId"))] });
	const tbl = elem(NAME_TBL, { children: [
		elem(NAME_TBL_PR, {
			attrs: [attr(ATTR_FIRST_ROW, opts.firstRow ?? true ? "1" : "0"), attr(ATTR_BAND_ROW, opts.bandRow ?? true ? "1" : "0")],
			children: [tableStyleId]
		}),
		elem(NAME_TBL_GRID, { children: colWidths.map((w) => elem(NAME_GRID_COL, { attrs: [attr(ATTR_W, String(emuExtent(w, "addSlideTable: column width")))] })) }),
		...rows.map((row, i) => buildTableRow(row, rowHeights[i] ?? 0, opts.textColorHex))
	] });
	return elem(NAME_GRAPHIC_FRAME$1, { children: [
		nvGraphicFramePr,
		xfrm,
		elem(NAME_GRAPHIC$1, { children: [elem(NAME_GRAPHIC_DATA$1, {
			attrs: [attr(ATTR_URI$1, TABLE_URI)],
			children: [tbl]
		})] })
	] });
};
//#endregion
//#region src/internal/presentationml/notes-slide-builder.ts
const NAME_NOTES_SLIDE = qname("p", "notes", NS.pml);
const NAME_CSLD$1 = qname("p", "cSld", NS.pml);
const NAME_SP_TREE$1 = qname("p", "spTree", NS.pml);
const NAME_NV_GRP_SP_PR = qname("p", "nvGrpSpPr", NS.pml);
const NAME_C_NV_PR = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_GRP_SP_PR = qname("p", "cNvGrpSpPr", NS.pml);
const NAME_C_NV_SP_PR = qname("p", "cNvSpPr", NS.pml);
const NAME_NV_PR$1 = qname("p", "nvPr", NS.pml);
const NAME_GRP_SP_PR = qname("p", "grpSpPr", NS.pml);
const NAME_SP = qname("p", "sp", NS.pml);
const NAME_NV_SP_PR = qname("p", "nvSpPr", NS.pml);
const NAME_SP_PR = qname("p", "spPr", NS.pml);
const NAME_PH = qname("p", "ph", NS.pml);
const NAME_TX_BODY$4 = qname("p", "txBody", NS.pml);
const NAME_CLR_MAP_OVR = qname("p", "clrMapOvr", NS.pml);
const NAME_MASTER_CLR_MAPPING = qname("a", "masterClrMapping", NS.dml);
const NAME_BODY_PR = qname("a", "bodyPr", NS.dml);
const NAME_LST_STYLE = qname("a", "lstStyle", NS.dml);
const NAME_P = qname("a", "p", NS.dml);
const NAME_R = qname("a", "r", NS.dml);
const NAME_RPR = qname("a", "rPr", NS.dml);
const NAME_T$1 = qname("a", "t", NS.dml);
const NAME_SP_LOCKS = qname("a", "spLocks", NS.dml);
const ATTR_ID$5 = qname("", "id", "");
const ATTR_NAME$2 = qname("", "name", "");
const ATTR_NO_GRP = qname("", "noGrp", "");
const ATTR_NO_ROT = qname("", "noRot", "");
const ATTR_NO_CHANGE_ASPECT = qname("", "noChangeAspect", "");
const ATTR_TYPE$1 = qname("", "type", "");
const ATTR_IDX$3 = qname("", "idx", "");
const ATTR_LANG = qname("", "lang", "");
const buildRootGroup = () => {
	return elem(NAME_NV_GRP_SP_PR, { children: [
		elem(NAME_C_NV_PR, { attrs: [attr(ATTR_ID$5, "1"), attr(ATTR_NAME$2, "")] }),
		elem(NAME_C_NV_GRP_SP_PR),
		elem(NAME_NV_PR$1)
	] });
};
const buildSldImgPlaceholder = (id) => {
	return elem(NAME_SP, { children: [elem(NAME_NV_SP_PR, { children: [
		elem(NAME_C_NV_PR, { attrs: [attr(ATTR_ID$5, String(id)), attr(ATTR_NAME$2, `Slide Image Placeholder ${id - 1}`)] }),
		elem(NAME_C_NV_SP_PR, { children: [elem(NAME_SP_LOCKS, { attrs: [
			attr(ATTR_NO_GRP, "1"),
			attr(ATTR_NO_ROT, "1"),
			attr(ATTR_NO_CHANGE_ASPECT, "1")
		] })] }),
		elem(NAME_NV_PR$1, { children: [elem(NAME_PH, { attrs: [attr(ATTR_TYPE$1, "sldImg")] })] })
	] }), elem(NAME_SP_PR)] });
};
const buildNotesParagraphs = (notes) => {
	return notes.split("\n").map((line) => {
		const t = elem(NAME_T$1, { children: line.length > 0 ? [text(line)] : [] });
		return elem(NAME_P, { children: [elem(NAME_R, { children: [elem(NAME_RPR, { attrs: [attr(ATTR_LANG, "en-US")] }), t] })] });
	});
};
const buildNotesBodyPlaceholder = (id, notes) => {
	const nvSpPr = elem(NAME_NV_SP_PR, { children: [
		elem(NAME_C_NV_PR, { attrs: [attr(ATTR_ID$5, String(id)), attr(ATTR_NAME$2, `Notes Placeholder ${id - 1}`)] }),
		elem(NAME_C_NV_SP_PR, { children: [elem(NAME_SP_LOCKS, { attrs: [attr(ATTR_NO_GRP, "1")] })] }),
		elem(NAME_NV_PR$1, { children: [elem(NAME_PH, { attrs: [attr(ATTR_TYPE$1, "body"), attr(ATTR_IDX$3, "1")] })] })
	] });
	const txBody = elem(NAME_TX_BODY$4, { children: [
		elem(NAME_BODY_PR),
		elem(NAME_LST_STYLE),
		...buildNotesParagraphs(notes)
	] });
	return elem(NAME_SP, { children: [
		nvSpPr,
		elem(NAME_SP_PR),
		txBody
	] });
};
/**
* Returns a fresh `<p:notes>` document with the given notes text in
* the body placeholder. Designed for callers that need to create the
* notesSlide part from scratch (no existing notes file yet for the
* slide).
*/
const buildEmptyNotesSlide = (notes) => {
	const cSld = elem(NAME_CSLD$1, { children: [elem(NAME_SP_TREE$1, { children: [
		buildRootGroup(),
		elem(NAME_GRP_SP_PR),
		buildSldImgPlaceholder(2),
		buildNotesBodyPlaceholder(3, notes)
	] })] });
	const clrMapOvr = elem(NAME_CLR_MAP_OVR, { children: [elem(NAME_MASTER_CLR_MAPPING)] });
	return {
		kind: "document",
		decl: {
			version: "1.0",
			encoding: "UTF-8",
			standalone: "yes"
		},
		prolog: [],
		root: elem(NAME_NOTES_SLIDE, {
			prefixDecls: new Map([
				["a", NS.dml],
				["r", NS.officeDocRels],
				["p", NS.pml]
			]),
			children: [cSld, clrMapOvr]
		}),
		epilog: []
	};
};
//#endregion
//#region src/internal/presentationml/transition-builder.ts
const NAME_TRANSITION = qname("p", "transition", NS.pml);
const ATTR_SPD = qname("", "spd", "");
const ATTR_ADV_CLICK = qname("", "advClick", "");
const ATTR_ADV_TM = qname("", "advTm", "");
const ATTR_DIR = qname("", "dir", "");
const ATTR_ORIENT = qname("", "orient", "");
const ATTR_THRU_BLK = qname("", "thruBlk", "");
/**
* Every transition effect element name in `CT_SlideTransition`'s choice
* (ECMA-376 pml.xsd). The token is emitted verbatim as `<p:{token}/>`, so this
* list is both the type's domain and the write-time validation domain —
* keeping them one declaration stops them drifting apart.
*/
const TRANSITION_EFFECTS = [
	"blinds",
	"checker",
	"circle",
	"dissolve",
	"comb",
	"cover",
	"cut",
	"diamond",
	"fade",
	"newsflash",
	"plus",
	"pull",
	"push",
	"random",
	"randomBar",
	"split",
	"strips",
	"wedge",
	"wheel",
	"wipe",
	"zoom"
];
const DIR_ORIENT = new Set(["horz", "vert"]);
const DIR_SIDE = new Set([
	"l",
	"u",
	"r",
	"d"
]);
const DIR_CORNER = new Set([
	"lu",
	"ru",
	"ld",
	"rd"
]);
const DIR_EIGHT = new Set([...DIR_SIDE, ...DIR_CORNER]);
const DIR_IN_OUT = new Set(["in", "out"]);
const DIR_DOMAINS = {
	blinds: DIR_ORIENT,
	checker: DIR_ORIENT,
	comb: DIR_ORIENT,
	randomBar: DIR_ORIENT,
	push: DIR_SIDE,
	wipe: DIR_SIDE,
	cover: DIR_EIGHT,
	pull: DIR_EIGHT,
	strips: DIR_CORNER,
	zoom: DIR_IN_OUT,
	split: DIR_IN_OUT
};
const THRU_BLK_EFFECTS = new Set(["fade", "cut"]);
const buildEffectElement = (opts) => {
	if (opts.effect === "none") return null;
	const name = qname("p", oneOf(opts.effect, TRANSITION_EFFECTS, "setSlideTransition: effect"), NS.pml);
	const attrs = [];
	if (opts.direction !== void 0) {
		const domain = DIR_DOMAINS[opts.effect];
		if (domain !== void 0) {
			if (!domain.has(opts.direction)) throw new Error(`setSlideTransition: direction "${opts.direction}" is not valid for effect "${opts.effect}" (allowed: ${[...domain].join(", ")})`);
			attrs.push(attr(ATTR_DIR, opts.direction));
		}
	}
	if (opts.orientation !== void 0 && opts.effect === "split") {
		oneOf(opts.orientation, ["horz", "vert"], "setSlideTransition: orientation");
		attrs.push(attr(ATTR_ORIENT, opts.orientation));
	}
	if (opts.thruBlack && THRU_BLK_EFFECTS.has(opts.effect)) attrs.push(attr(ATTR_THRU_BLK, "1"));
	return elem(name, { attrs });
};
/** Returns a complete `<p:transition>` element. */
const buildTransition = (opts) => {
	if (opts.speed !== void 0) oneOf(opts.speed, [
		"slow",
		"med",
		"fast"
	], "setSlideTransition: speed");
	const attrs = [];
	if (opts.speed !== void 0) attrs.push(attr(ATTR_SPD, opts.speed));
	if (opts.advanceOnClick === false) attrs.push(attr(ATTR_ADV_CLICK, "0"));
	if (opts.advanceAfterMs !== void 0) {
		const advTm = unsignedIntMs(opts.advanceAfterMs, "setSlideTransition: advanceAfterMs");
		attrs.push(attr(ATTR_ADV_TM, String(advTm)));
	}
	const effect = buildEffectElement(opts);
	return elem(NAME_TRANSITION, {
		attrs,
		children: effect === null ? [] : [effect]
	});
};
//#endregion
//#region src/internal/presentationml/animation-builder.ts
const NAME_TIMING$1 = qname("p", "timing", NS.pml);
const NAME_TN_LST$1 = qname("p", "tnLst", NS.pml);
const NAME_PAR$1 = qname("p", "par", NS.pml);
const NAME_C_TN$1 = qname("p", "cTn", NS.pml);
const NAME_CHILD_TN_LST$1 = qname("p", "childTnLst", NS.pml);
const NAME_SEQ = qname("p", "seq", NS.pml);
const NAME_ST_COND_LST = qname("p", "stCondLst", NS.pml);
const NAME_PREV_COND_LST = qname("p", "prevCondLst", NS.pml);
const NAME_NEXT_COND_LST = qname("p", "nextCondLst", NS.pml);
const NAME_COND = qname("p", "cond", NS.pml);
const NAME_TGT_EL = qname("p", "tgtEl", NS.pml);
const NAME_SP_TGT = qname("p", "spTgt", NS.pml);
const NAME_SLD_TGT = qname("p", "sldTgt", NS.pml);
const NAME_ATTR_NAME_LST = qname("p", "attrNameLst", NS.pml);
const NAME_ATTR_NAME_FN = qname("p", "attrName", NS.pml);
const NAME_SET = qname("p", "set", NS.pml);
const NAME_C_BHVR = qname("p", "cBhvr", NS.pml);
const NAME_TO = qname("p", "to", NS.pml);
const NAME_STR_VAL = qname("p", "strVal", NS.pml);
const NAME_FLT_VAL = qname("p", "fltVal", NS.pml);
const NAME_VAL$1 = qname("p", "val", NS.pml);
const NAME_ANIM = qname("p", "anim", NS.pml);
const NAME_TAV_LST = qname("p", "tavLst", NS.pml);
const NAME_TAV = qname("p", "tav", NS.pml);
const NAME_BLD_LST = qname("p", "bldLst", NS.pml);
const NAME_BLD_P = qname("p", "bldP", NS.pml);
const ATTR_ID$4 = qname("", "id", "");
const ATTR_DUR = qname("", "dur", "");
const ATTR_RESTART = qname("", "restart", "");
const ATTR_NODE_TYPE = qname("", "nodeType", "");
const ATTR_FILL = qname("", "fill", "");
const ATTR_DELAY = qname("", "delay", "");
const ATTR_PRESET_ID = qname("", "presetID", "");
const ATTR_PRESET_CLASS = qname("", "presetClass", "");
const ATTR_PRESET_SUBTYPE = qname("", "presetSubtype", "");
const ATTR_GRP_ID = qname("", "grpId", "");
const ATTR_CONCURRENT = qname("", "concurrent", "");
const ATTR_NEXT_AC = qname("", "nextAc", "");
const ATTR_SPID = qname("", "spid", "");
const ATTR_EVT = qname("", "evt", "");
const ATTR_VAL$3 = qname("", "val", "");
const ATTR_CALCMODE = qname("", "calcmode", "");
const ATTR_VALUE_TYPE = qname("", "valueType", "");
const ATTR_ADDITIVE = qname("", "additive", "");
const ATTR_TM = qname("", "tm", "");
const PRESETS = {
	appear: {
		presetId: 1,
		presetClass: "entr",
		presetSubtype: 0
	},
	fadeIn: {
		presetId: 10,
		presetClass: "entr",
		presetSubtype: 0
	},
	disappear: {
		presetId: 1,
		presetClass: "exit",
		presetSubtype: 0
	},
	fadeOut: {
		presetId: 10,
		presetClass: "exit",
		presetSubtype: 0
	}
};
const buildSetVisibility = (spid, visible) => {
	const tgt = elem(NAME_TGT_EL, { children: [elem(NAME_SP_TGT, { attrs: [attr(ATTR_SPID, String(spid))] })] });
	const attrName = elem(NAME_ATTR_NAME_LST, { children: [elem(NAME_ATTR_NAME_FN, { children: [{
		kind: "text",
		data: "style.visibility"
	}] })] });
	return elem(NAME_SET, { children: [elem(NAME_C_BHVR, { children: [
		elem(NAME_C_TN$1, {
			attrs: [
				attr(ATTR_ID$4, "6"),
				attr(ATTR_DUR, "1"),
				attr(ATTR_FILL, "hold")
			],
			children: [elem(NAME_ST_COND_LST, { children: [elem(NAME_COND, { attrs: [attr(ATTR_DELAY, "0")] })] })]
		}),
		tgt,
		attrName
	] }), elem(NAME_TO, { children: [elem(NAME_STR_VAL, { attrs: [attr(ATTR_VAL$3, visible ? "visible" : "hidden")] })] })] });
};
const buildOpacityAnim = (spid, durationMs, fadeIn) => {
	const tgt = elem(NAME_TGT_EL, { children: [elem(NAME_SP_TGT, { attrs: [attr(ATTR_SPID, String(spid))] })] });
	const attrName = elem(NAME_ATTR_NAME_LST, { children: [elem(NAME_ATTR_NAME_FN, { children: [{
		kind: "text",
		data: "style.opacity"
	}] })] });
	const cTn = elem(NAME_C_TN$1, { attrs: [
		attr(ATTR_ID$4, "7"),
		attr(ATTR_DUR, String(durationMs)),
		attr(ATTR_FILL, "hold")
	] });
	const cBhvr = elem(NAME_C_BHVR, {
		attrs: [attr(ATTR_ADDITIVE, "base")],
		children: [
			cTn,
			tgt,
			attrName
		]
	});
	const fromVal = fadeIn ? "0" : "1";
	const toVal = fadeIn ? "1" : "0";
	const tavLst = elem(NAME_TAV_LST, { children: [elem(NAME_TAV, {
		attrs: [attr(ATTR_TM, "0")],
		children: [elem(NAME_VAL$1, { children: [elem(NAME_FLT_VAL, { attrs: [attr(ATTR_VAL$3, fromVal)] })] })]
	}), elem(NAME_TAV, {
		attrs: [attr(ATTR_TM, "100000")],
		children: [elem(NAME_VAL$1, { children: [elem(NAME_FLT_VAL, { attrs: [attr(ATTR_VAL$3, toVal)] })] })]
	})] });
	return elem(NAME_ANIM, {
		attrs: [attr(ATTR_CALCMODE, "lin"), attr(ATTR_VALUE_TYPE, "num")],
		children: [cBhvr, tavLst]
	});
};
/**
* Builds the complete `<p:timing>` element for a single click-effect on
* the given shape id.
*/
const buildSingleEffectTiming = (spid, opts) => {
	const preset = PRESETS[oneOf(opts.effect, [
		"fadeIn",
		"fadeOut",
		"appear",
		"disappear"
	], "setShapeAnimation: effect")];
	const duration = opts.durationMs === void 0 ? 500 : unsignedIntMs(opts.durationMs, "setShapeAnimation: durationMs");
	const isFade = opts.effect === "fadeIn" || opts.effect === "fadeOut";
	const isEntrance = preset.presetClass === "entr";
	const effectChildren = [];
	effectChildren.push(buildSetVisibility(spid, isEntrance));
	if (isFade) effectChildren.push(buildOpacityAnim(spid, duration, isEntrance));
	const effectPar = elem(NAME_PAR$1, { children: [elem(NAME_C_TN$1, {
		attrs: [
			attr(ATTR_ID$4, "5"),
			attr(ATTR_PRESET_ID, String(preset.presetId)),
			attr(ATTR_PRESET_CLASS, preset.presetClass),
			attr(ATTR_PRESET_SUBTYPE, String(preset.presetSubtype)),
			attr(ATTR_FILL, "hold"),
			attr(ATTR_GRP_ID, "0"),
			attr(ATTR_NODE_TYPE, "clickEffect")
		],
		children: [elem(NAME_ST_COND_LST, { children: [elem(NAME_COND, { attrs: [attr(ATTR_DELAY, "0")] })] }), elem(NAME_CHILD_TN_LST$1, { children: effectChildren })]
	})] });
	const clickWrapperPar = elem(NAME_PAR$1, { children: [elem(NAME_C_TN$1, {
		attrs: [attr(ATTR_ID$4, "4"), attr(ATTR_FILL, "hold")],
		children: [elem(NAME_ST_COND_LST, { children: [elem(NAME_COND, { attrs: [attr(ATTR_DELAY, "0")] })] }), elem(NAME_CHILD_TN_LST$1, { children: [effectPar] })]
	})] });
	const indefinitePar = elem(NAME_PAR$1, { children: [elem(NAME_C_TN$1, {
		attrs: [attr(ATTR_ID$4, "3"), attr(ATTR_FILL, "hold")],
		children: [elem(NAME_ST_COND_LST, { children: [elem(NAME_COND, { attrs: [attr(ATTR_DELAY, "indefinite")] })] }), elem(NAME_CHILD_TN_LST$1, { children: [clickWrapperPar] })]
	})] });
	const mainSeqCTn = elem(NAME_C_TN$1, {
		attrs: [
			attr(ATTR_ID$4, "2"),
			attr(ATTR_DUR, "indefinite"),
			attr(ATTR_NODE_TYPE, "mainSeq")
		],
		children: [elem(NAME_CHILD_TN_LST$1, { children: [indefinitePar] })]
	});
	const prevCond = elem(NAME_PREV_COND_LST, { children: [elem(NAME_COND, {
		attrs: [attr(ATTR_EVT, "onPrev"), attr(ATTR_DELAY, "0")],
		children: [elem(NAME_TGT_EL, { children: [elem(NAME_SLD_TGT)] })]
	})] });
	const nextCond = elem(NAME_NEXT_COND_LST, { children: [elem(NAME_COND, {
		attrs: [attr(ATTR_EVT, "onNext"), attr(ATTR_DELAY, "0")],
		children: [elem(NAME_TGT_EL, { children: [elem(NAME_SLD_TGT)] })]
	})] });
	const seq = elem(NAME_SEQ, {
		attrs: [attr(ATTR_CONCURRENT, "1"), attr(ATTR_NEXT_AC, "seek")],
		children: [
			mainSeqCTn,
			prevCond,
			nextCond
		]
	});
	return elem(NAME_TIMING$1, { children: [elem(NAME_TN_LST$1, { children: [elem(NAME_PAR$1, { children: [elem(NAME_C_TN$1, {
		attrs: [
			attr(ATTR_ID$4, "1"),
			attr(ATTR_DUR, "indefinite"),
			attr(ATTR_RESTART, "never"),
			attr(ATTR_NODE_TYPE, "tmRoot")
		],
		children: [elem(NAME_CHILD_TN_LST$1, { children: [seq] })]
	})] })] }), elem(NAME_BLD_LST, { children: [elem(NAME_BLD_P, { attrs: [attr(ATTR_SPID, String(spid)), attr(ATTR_GRP_ID, "0")] })] })] });
};
//#endregion
//#region src/internal/presentationml/comments-part.ts
const NAME_CM_AUTHOR_LST = qname("p", "cmAuthorLst", NS.pml);
const NAME_CM_AUTHOR = qname("p", "cmAuthor", NS.pml);
const NAME_CM_LST = qname("p", "cmLst", NS.pml);
const NAME_CM = qname("p", "cm", NS.pml);
const NAME_POS = qname("p", "pos", NS.pml);
const NAME_TEXT = qname("p", "text", NS.pml);
const ATTR_ID$3 = qname("", "id", "");
const ATTR_NAME$1 = qname("", "name", "");
const ATTR_INITIALS = qname("", "initials", "");
const ATTR_LAST_IDX = qname("", "lastIdx", "");
const ATTR_CLR_IDX = qname("", "clrIdx", "");
const ATTR_AUTHOR_ID = qname("", "authorId", "");
const ATTR_DT = qname("", "dt", "");
const ATTR_IDX$2 = qname("", "idx", "");
const ATTR_X = qname("", "x", "");
const ATTR_Y = qname("", "y", "");
const readCommentAuthorList = (root) => {
	if (root.name.namespaceURI !== NS.pml || root.name.localName !== "cmAuthorLst") throw new Error(`expected <p:cmAuthorLst> root, got <${root.name.prefix}:${root.name.localName}>`);
	const authors = [];
	for (const el of allChildElements(root, NAME_CM_AUTHOR)) {
		const idRaw = getAttrValue(el, ATTR_ID$3);
		const nameVal = getAttrValue(el, ATTR_NAME$1);
		const initialsVal = getAttrValue(el, ATTR_INITIALS);
		const lastIdxRaw = getAttrValue(el, ATTR_LAST_IDX);
		const clrIdxRaw = getAttrValue(el, ATTR_CLR_IDX);
		if (idRaw === null) continue;
		const id = Number.parseInt(idRaw, 10);
		if (!Number.isFinite(id)) continue;
		authors.push({
			id,
			name: nameVal ?? "",
			initials: initialsVal ?? "",
			lastIdx: lastIdxRaw !== null ? Number.parseInt(lastIdxRaw, 10) || 0 : 0,
			clrIdx: clrIdxRaw !== null ? Number.parseInt(clrIdxRaw, 10) || null : null
		});
	}
	return { authors };
};
const readCommentList = (root) => {
	if (root.name.namespaceURI !== NS.pml || root.name.localName !== "cmLst") throw new Error(`expected <p:cmLst> root, got <${root.name.prefix}:${root.name.localName}>`);
	const comments = [];
	for (const el of allChildElements(root, NAME_CM)) {
		const authorIdRaw = getAttrValue(el, ATTR_AUTHOR_ID);
		const idxRaw = getAttrValue(el, ATTR_IDX$2);
		const dtVal = getAttrValue(el, ATTR_DT);
		if (authorIdRaw === null || idxRaw === null) continue;
		const authorId = Number.parseInt(authorIdRaw, 10);
		const idx = Number.parseInt(idxRaw, 10);
		if (!Number.isFinite(authorId) || !Number.isFinite(idx)) continue;
		let position = null;
		const posEl = firstChildElement(el, NAME_POS);
		if (posEl !== null) {
			const xRaw = getAttrValue(posEl, ATTR_X);
			const yRaw = getAttrValue(posEl, ATTR_Y);
			if (xRaw !== null && yRaw !== null) {
				const x = Number.parseInt(xRaw, 10);
				const y = Number.parseInt(yRaw, 10);
				if (Number.isFinite(x) && Number.isFinite(y)) position = {
					x,
					y
				};
			}
		}
		let text = "";
		const textEl = firstChildElement(el, NAME_TEXT);
		if (textEl !== null) {
			for (const child of textEl.children) if (child.kind === "text" || child.kind === "cdata") text += child.data;
		}
		comments.push({
			authorId,
			idx,
			dt: dtVal,
			text,
			position
		});
	}
	return { comments };
};
const commentAuthorElement = (a) => {
	return elem(NAME_CM_AUTHOR, { attrs: [
		attr(ATTR_ID$3, String(a.id)),
		attr(ATTR_NAME$1, a.name),
		attr(ATTR_INITIALS, a.initials),
		attr(ATTR_LAST_IDX, String(a.lastIdx)),
		attr(ATTR_CLR_IDX, String(a.clrIdx ?? 0))
	] });
};
const buildCommentAuthorListDoc = (authors) => {
	return {
		kind: "document",
		decl: {
			version: "1.0",
			encoding: "UTF-8",
			standalone: "yes"
		},
		prolog: [],
		root: elem(NAME_CM_AUTHOR_LST, {
			prefixDecls: new Map([["p", NS.pml]]),
			children: authors.map(commentAuthorElement)
		}),
		epilog: []
	};
};
const commentElement = (c) => {
	const attrs = [attr(ATTR_AUTHOR_ID, String(c.authorId)), attr(ATTR_IDX$2, String(c.idx))];
	if (c.dt !== null) attrs.push(attr(ATTR_DT, c.dt));
	const children = [];
	if (c.position !== null) children.push(elem(NAME_POS, { attrs: [attr(ATTR_X, String(c.position.x)), attr(ATTR_Y, String(c.position.y))] }));
	children.push(elem(NAME_TEXT, { children: [text(c.text)] }));
	return elem(NAME_CM, {
		attrs,
		children
	});
};
const buildCommentListDoc = (comments) => {
	return {
		kind: "document",
		decl: {
			version: "1.0",
			encoding: "UTF-8",
			standalone: "yes"
		},
		prolog: [],
		root: elem(NAME_CM_LST, {
			prefixDecls: new Map([["p", NS.pml]]),
			children: comments.map(commentElement)
		}),
		epilog: []
	};
};
//#endregion
//#region src/api/fn/_helpers.ts
const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER$1 = new TextEncoder();
const decode$1 = (b) => TEXT_DECODER.decode(b);
const encode$1 = (s) => TEXT_ENCODER$1.encode(s);
const SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const PRES_PART_NAME = partName("/ppt/presentation.xml");
const NAME_PRESENTATION = qname("p", "presentation", NS.pml);
const NAME_SLD_MASTER_ID_LST = qname("p", "sldMasterIdLst", NS.pml);
const NAME_SLD_ID_LST$1 = qname("p", "sldIdLst", NS.pml);
const NAME_SLD_ID$1 = qname("p", "sldId", NS.pml);
const NAME_CSLD = qname("p", "cSld", NS.pml);
const NAME_SP_TREE = qname("p", "spTree", NS.pml);
const ATTR_ID$2 = qname("", "id", "");
const ATTR_R_ID$1 = qname("r", "id", NS.officeDocRels);
const SLD_ID_MAX = 2147482623;
const commitSlideData = (slide) => {
	const xml = serializeXml(slide[SLIDE_DOCUMENT]);
	const part = slide[INTERNAL_PACKAGE].getPart(slide[SLIDE_PART_NAME]);
	if (!part) throw new Error(`slide part missing: ${slide[SLIDE_PART_NAME]}`);
	part.data = encode$1(xml);
};
const refreshSlideData = (slide) => {
	const fresh = readSlidePart(slide[SLIDE_DOCUMENT].root);
	slide[SLIDE_PART] = fresh;
	const shapes = slide[SLIDE_SHAPES];
	for (let i = 0; i < shapes.length; i++) {
		const next = fresh.shapes[i];
		const existing = shapes[i];
		if (!next || !existing) continue;
		existing[SHAPE_ELEMENT] = next.element;
		existing[SHAPE_SNAPSHOT] = next;
	}
};
const rebuildShapesFromDocument = (slide) => {
	const fresh = readSlidePart(slide[SLIDE_DOCUMENT].root);
	slide[SLIDE_PART] = fresh;
	const shapes = [];
	for (const snap of fresh.shapes) shapes.push({
		[SHAPE_SLIDE]: slide,
		[SHAPE_ELEMENT]: snap.element,
		[SHAPE_SNAPSHOT]: snap
	});
	slide[SLIDE_SHAPES] = shapes;
};
const NAME_TX_BODY$3 = qname("p", "txBody", NS.pml);
const requireSpPr = (shape) => {
	const kind = shape[SHAPE_SNAPSHOT].kind;
	if (kind !== "shape" && kind !== "picture" && kind !== "connector") throw new Error(`fill/stroke is not supported on ${kind} shapes`);
	const spPrName = qname("p", "spPr", NS.pml);
	const el = shape[SHAPE_ELEMENT];
	let spPr = firstChildElement(el, spPrName);
	if (spPr === null) {
		spPr = {
			kind: "element",
			name: spPrName,
			attrs: [],
			prefixDecls: /* @__PURE__ */ new Map(),
			children: []
		};
		el.children.push(spPr);
	}
	return spPr;
};
const requireTxBody = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "shape") throw new Error(`text operations require a shape kind; ${shape[SHAPE_SNAPSHOT].kind} is not text-bearing`);
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY$3);
	if (txBody === null) throw new Error(`shape "${shape[SHAPE_SNAPSHOT].name}" has no <p:txBody>`);
	return txBody;
};
const commitAndRefresh = (shape) => {
	commitSlideData(shape[SHAPE_SLIDE]);
	refreshSlideData(shape[SHAPE_SLIDE]);
};
const LINK_REL_TYPES = new Set([REL_TYPES.hyperlink, REL_TYPES.slide]);
/** Drops the slide's link rels that no element references any more. */
const releaseUnusedLinkRels = (slide) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (rels === null) return;
	const referenced = /* @__PURE__ */ new Set();
	walkElements(slide[SLIDE_DOCUMENT].root, (element) => {
		for (const a of element.attrs) if (a.name.namespaceURI === NS.officeDocRels) referenced.add(a.value);
	});
	const kept = rels.items.filter((rel) => !LINK_REL_TYPES.has(rel.type) || referenced.has(rel.id));
	if (kept.length === rels.items.length) return;
	pkg.setRels(slide[SLIDE_PART_NAME], { items: kept });
};
const requireSpTree = (slide) => {
	const cSld = firstChildElement(slide[SLIDE_DOCUMENT].root, NAME_CSLD);
	if (!cSld) throw new Error("slide has no <p:cSld>");
	const spTree = firstChildElement(cSld, NAME_SP_TREE);
	if (!spTree) throw new Error("slide has no <p:spTree>");
	return spTree;
};
const nextShapeId = (slide) => {
	let maxId = 0;
	for (const s of slide[SLIDE_PART].shapes) if (s.id > maxId) maxId = s.id;
	return Math.max(maxId, 1) + 1;
};
const appendAndReturnNewShape = (slide, child) => {
	requireSpTree(slide).children.push(child);
	commitSlideData(slide);
	const previousLength = slide[SLIDE_SHAPES].length;
	rebuildShapesFromDocument(slide);
	const created = slide[SLIDE_SHAPES][previousLength];
	if (!created) throw new Error("appendShape: post-condition failed");
	return created;
};
const setOpcDefault = (pkg, extension, contentType) => {
	if (!pkg.contentTypes.defaults.some((d) => d.extension.toLowerCase() === extension)) pkg.contentTypes.defaults.push({
		extension,
		contentType
	});
};
//#endregion
//#region src/api/fn/theme.ts
const THEME_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.theme+xml";
const NAME_THEME_ELEMENTS = qname("a", "themeElements", NS.dml);
const NAME_CLR_SCHEME = qname("a", "clrScheme", NS.dml);
const NAME_SRGB_CLR$1 = qname("a", "srgbClr", NS.dml);
const NAME_SYS_CLR = qname("a", "sysClr", NS.dml);
const ATTR_VAL$2 = qname("", "val", "");
const ATTR_NAME = qname("", "name", "");
const ATTR_TYPEFACE$1 = qname("", "typeface", "");
const CLR_SCHEME_SLOTS = [
	["dark1", "dk1"],
	["light1", "lt1"],
	["dark2", "dk2"],
	["light2", "lt2"],
	["accent1", "accent1"],
	["accent2", "accent2"],
	["accent3", "accent3"],
	["accent4", "accent4"],
	["accent5", "accent5"],
	["accent6", "accent6"],
	["hyperlink", "hlink"],
	["followedHyperlink", "folHlink"]
];
const readSchemeSlot = (parent, local) => {
	const slot = firstChildElement(parent, qname("a", local, NS.dml));
	if (!slot) return "";
	const srgb = firstChildElement(slot, NAME_SRGB_CLR$1);
	if (srgb) {
		const v = getAttrValue(srgb, qname("", "val", ""));
		if (v) return `#${v.toUpperCase()}`;
	}
	const sys = firstChildElement(slot, NAME_SYS_CLR);
	if (sys) {
		const last = getAttrValue(sys, qname("", "lastClr", ""));
		if (last) return `#${last.toUpperCase()}`;
	}
	return "";
};
/**
* Returns the deck's color scheme as `#RRGGBB` strings, or `null` if
* the package carries no theme. Each accent slot maps directly to the
* `accent1`–`accent6` chart palette defaults.
*
* The deck's theme is the one its first slide master references. A
* package usually holds more themes than that — notes and handout
* masters carry their own, and Google Slides exports name the notes
* theme `theme1.xml` ahead of the slide theme `theme2.xml` — so the
* slide master relationship decides, not the part name. Multi-master
* decks surface the first master's theme only; per-master theme lookup
* will land if a concrete user need shows up.
*/
const getPresentationTheme = (pres) => themeFromPackage(pres[INTERNAL_PACKAGE]);
const readRoots = /* @__PURE__ */ new WeakMap();
const readRoot = (bytes) => {
	let root = readRoots.get(bytes);
	if (!root) {
		root = parseXml(decode$1(bytes)).root;
		readRoots.set(bytes, root);
	}
	return root;
};
const resolveRelTarget = (from, target) => target.startsWith("/") ? partName(target) : resolveTarget(from, target);
/** The theme part `from` relates to, or `null` when it has no theme rel. */
const themePartRelatedTo = (pkg, from) => {
	const rel = pkg.getRels(from)?.items.find((r) => r.type === REL_TYPES.theme && r.targetMode === "Internal");
	if (!rel) return null;
	const part = pkg.getPart(resolveRelTarget(from, rel.target));
	return part !== null && part.contentType === THEME_CONTENT_TYPE ? part : null;
};
/** The first slide master's part name, in `<p:sldMasterIdLst>` order. */
const firstSlideMasterPartName = (pkg) => {
	const presPart = pkg.getPart(PRES_PART_NAME);
	const presRels = pkg.getRels(PRES_PART_NAME);
	if (presPart === null || presRels === null) return null;
	const firstId = firstChildElement(readRoot(presPart.data), NAME_SLD_MASTER_ID_LST)?.children.find((c) => c.kind === "element");
	const rId = firstId?.kind === "element" ? getAttrValue(firstId, ATTR_R_ID$1) : null;
	const rel = presRels.items.find((r) => r.type === REL_TYPES.slideMaster && (rId === null || r.id === rId)) ?? presRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	return rel ? resolveRelTarget(PRES_PART_NAME, rel.target) : null;
};
/**
* The theme part the slides render with — see {@link getPresentationTheme}
* for why the slide master's relationship decides. Falls back to the
* presentation part's own theme rel, then to the first theme part by
* name for hand-built packages that wire neither. Shared by every theme
* reader/writer so they agree on which theme a deck exposes.
*/
const deckThemePart = (pkg) => {
	const masterName = firstSlideMasterPartName(pkg);
	const viaMaster = masterName === null ? null : themePartRelatedTo(pkg, masterName);
	if (viaMaster) return viaMaster;
	const viaPresentation = themePartRelatedTo(pkg, PRES_PART_NAME);
	if (viaPresentation) return viaPresentation;
	return pkg.parts.filter((p) => p.contentType === THEME_CONTENT_TYPE).sort((a, b) => a.name.localeCompare(b.name))[0];
};
/**
* Package-level theme reader behind {@link getPresentationTheme}. Exposed so
* helpers holding only a package handle (e.g. color baking off a `SlideData`)
* can read the theme without a `PresentationData`.
*
* @internal
*/
const themeFromPackage = (pkg) => {
	const themePart = deckThemePart(pkg);
	if (!themePart) return null;
	const themeElements = firstChildElement(readRoot(themePart.data), NAME_THEME_ELEMENTS);
	if (!themeElements) return null;
	const clrScheme = firstChildElement(themeElements, NAME_CLR_SCHEME);
	if (!clrScheme) return null;
	return {
		name: getAttrValue(clrScheme, qname("", "name", "")) ?? "",
		dark1: readSchemeSlot(clrScheme, "dk1"),
		light1: readSchemeSlot(clrScheme, "lt1"),
		dark2: readSchemeSlot(clrScheme, "dk2"),
		light2: readSchemeSlot(clrScheme, "lt2"),
		accent1: readSchemeSlot(clrScheme, "accent1"),
		accent2: readSchemeSlot(clrScheme, "accent2"),
		accent3: readSchemeSlot(clrScheme, "accent3"),
		accent4: readSchemeSlot(clrScheme, "accent4"),
		accent5: readSchemeSlot(clrScheme, "accent5"),
		accent6: readSchemeSlot(clrScheme, "accent6"),
		hyperlink: readSchemeSlot(clrScheme, "hlink"),
		followedHyperlink: readSchemeSlot(clrScheme, "folHlink")
	};
};
const readTypeface = (parent, local) => {
	if (!parent) return null;
	const el = firstChildElement(parent, qname("a", local, NS.dml));
	if (!el) return null;
	const v = getAttrValue(el, qname("", "typeface", ""));
	if (!v) return null;
	return v;
};
/**
* Returns the deck theme's font scheme, or `null` when the package
* carries no theme. As with `getPresentationTheme`, the deck theme is
* the first slide master's; per-master font lookup will land if needed.
*/
const getPresentationFonts = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const themePart = deckThemePart(pkg);
	if (!themePart) return null;
	const themeElements = firstChildElement(readRoot(themePart.data), NAME_THEME_ELEMENTS);
	if (!themeElements) return null;
	const fontScheme = firstChildElement(themeElements, qname("a", "fontScheme", NS.dml));
	if (!fontScheme) return null;
	const majorFont = firstChildElement(fontScheme, qname("a", "majorFont", NS.dml));
	const minorFont = firstChildElement(fontScheme, qname("a", "minorFont", NS.dml));
	return {
		majorLatin: readTypeface(majorFont, "latin"),
		majorEastAsian: readTypeface(majorFont, "ea"),
		majorComplexScript: readTypeface(majorFont, "cs"),
		minorLatin: readTypeface(minorFont, "latin"),
		minorEastAsian: readTypeface(minorFont, "ea"),
		minorComplexScript: readTypeface(minorFont, "cs")
	};
};
/**
* Overwrites the named slots of the deck theme's color
* scheme (`<a:clrScheme>`), leaving every other slot untouched. Slot
* values are `#RRGGBB` (or 3-digit `#RGB`) strings; every branded
* `srgbClr`/`sysClr` slot is normalized to a plain `<a:srgbClr>` on
* write, since a theme slot is never a scheme-color reference.
*
* As with `getPresentationTheme`, multi-master decks are branded via
* their first slide master's theme only.
*
* Throws if the presentation has no theme part, or if a provided color
* isn't a valid `#RRGGBB` string.
*/
const setPresentationTheme = (pres, theme) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const themePart = deckThemePart(pkg);
	if (!themePart) throw new Error("setPresentationTheme: presentation has no theme part");
	const doc = parseXml(decode$1(themePart.data));
	const themeElements = firstChildElement(doc.root, NAME_THEME_ELEMENTS);
	if (!themeElements) throw new Error("setPresentationTheme: theme part has no <a:themeElements>");
	const clrScheme = firstChildElement(themeElements, NAME_CLR_SCHEME);
	if (!clrScheme) throw new Error("setPresentationTheme: theme part has no <a:clrScheme>");
	if (theme.name !== void 0) {
		clrScheme.attrs = clrScheme.attrs.filter((a) => a.name.localName !== "name");
		clrScheme.attrs.push(attr(ATTR_NAME, theme.name));
	}
	for (const [field, local] of CLR_SCHEME_SLOTS) {
		const value = theme[field];
		if (value === void 0) continue;
		const hex = parseSrgbHex(value);
		if (hex === null) throw new Error(`setPresentationTheme: "${field}" must be a #RRGGBB or #RGB color, got ${JSON.stringify(value)}`);
		const slotName = qname("a", local, NS.dml);
		const idx = clrScheme.children.findIndex((c) => c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === local);
		if (idx < 0) throw new Error(`setPresentationTheme: clrScheme is missing <a:${local}>`);
		clrScheme.children[idx] = elem(slotName, { children: [elem(NAME_SRGB_CLR$1, { attrs: [attr(ATTR_VAL$2, hex)] })] });
	}
	themePart.data = encode$1(serializeXml(doc));
};
const setTypeface = (fontCollection, local, typeface) => {
	const el = firstChildElement(fontCollection, qname("a", local, NS.dml));
	if (!el) throw new Error(`setPresentationFonts: fontScheme is missing <a:${local}>`);
	el.attrs = el.attrs.filter((a) => a.name.localName !== "typeface");
	el.attrs.push(attr(ATTR_TYPEFACE$1, typeface));
};
/**
* Overwrites the named typefaces of the deck theme's font scheme
* (major = headings, minor = body), leaving unset fields untouched. As
* with `setPresentationTheme`, only the first slide master's theme is
* branded.
*
* Throws if the presentation has no theme part.
*/
const setPresentationFonts = (pres, fonts) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const themePart = deckThemePart(pkg);
	if (!themePart) throw new Error("setPresentationFonts: presentation has no theme part");
	const doc = parseXml(decode$1(themePart.data));
	const themeElements = firstChildElement(doc.root, NAME_THEME_ELEMENTS);
	if (!themeElements) throw new Error("setPresentationFonts: theme part has no <a:themeElements>");
	const fontScheme = firstChildElement(themeElements, qname("a", "fontScheme", NS.dml));
	if (!fontScheme) throw new Error("setPresentationFonts: theme part has no <a:fontScheme>");
	const majorFont = firstChildElement(fontScheme, qname("a", "majorFont", NS.dml));
	if (!majorFont) throw new Error("setPresentationFonts: fontScheme has no <a:majorFont>");
	const minorFont = firstChildElement(fontScheme, qname("a", "minorFont", NS.dml));
	if (!minorFont) throw new Error("setPresentationFonts: fontScheme has no <a:minorFont>");
	if (fonts.majorLatin !== void 0) setTypeface(majorFont, "latin", fonts.majorLatin);
	if (fonts.majorEastAsian !== void 0) setTypeface(majorFont, "ea", fonts.majorEastAsian);
	if (fonts.majorComplexScript !== void 0) setTypeface(majorFont, "cs", fonts.majorComplexScript);
	if (fonts.minorLatin !== void 0) setTypeface(minorFont, "latin", fonts.minorLatin);
	if (fonts.minorEastAsian !== void 0) setTypeface(minorFont, "ea", fonts.minorEastAsian);
	if (fonts.minorComplexScript !== void 0) setTypeface(minorFont, "cs", fonts.minorComplexScript);
	themePart.data = encode$1(serializeXml(doc));
};
//#endregion
//#region src/api/fn/comments.ts
const COMMENT_AUTHORS_PART_NAME = partName("/ppt/commentAuthors.xml");
const COMMENT_AUTHORS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml";
const COMMENTS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.comments+xml";
const slideNumberFromPartName = (name) => {
	const m = name.match(/^\/ppt\/slides\/slide(\d+)\.xml$/);
	if (!m?.[1]) throw new Error(`comments: cannot derive slide number from ${name}`);
	return Number.parseInt(m[1], 10);
};
const commentsPartNameForSlide = (slide) => {
	return partName(`/ppt/comments/comment${slideNumberFromPartName(slide[SLIDE_PART_NAME])}.xml`);
};
const loadAuthorList = (pkg) => {
	const part = pkg.getPart(COMMENT_AUTHORS_PART_NAME);
	if (part === null) return [];
	return readCommentAuthorList(parseXml(decode$1(part.data)).root).authors.slice();
};
const writeAuthorList = (pkg, authors) => {
	const bytes = encode$1(serializeXml(buildCommentAuthorListDoc(authors)));
	const existing = pkg.getPart(COMMENT_AUTHORS_PART_NAME);
	if (existing !== null) {
		existing.data = bytes;
		return;
	}
	pkg.addPart(COMMENT_AUTHORS_PART_NAME, COMMENT_AUTHORS_CONTENT_TYPE, bytes);
	const presRels = pkg.getRels(PRES_PART_NAME) ?? emptyRels();
	if (!presRels.items.some((r) => r.type === REL_TYPES.commentAuthors && r.target.endsWith("commentAuthors.xml"))) {
		presRels.items.push({
			id: nextRelId(presRels.items.map((r) => r.id)),
			type: REL_TYPES.commentAuthors,
			target: "commentAuthors.xml",
			targetMode: "Internal"
		});
		pkg.setRels(PRES_PART_NAME, presRels);
	}
};
const loadCommentsForSlide = (slide) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const partNameValue = commentsPartNameForSlide(slide);
	const part = pkg.getPart(partNameValue);
	if (part === null) return [];
	return readCommentList(parseXml(decode$1(part.data)).root).comments.slice();
};
const writeCommentsForSlide = (slide, comments) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const commentsName = commentsPartNameForSlide(slide);
	if (comments.length === 0) {
		if (pkg.getPart(commentsName) !== null) pkg.removePart(commentsName);
		const slideRels = pkg.getRels(slide[SLIDE_PART_NAME]);
		if (slideRels !== null) {
			const before = slideRels.items.length;
			slideRels.items = slideRels.items.filter((r) => r.type !== REL_TYPES.comments);
			if (slideRels.items.length !== before) pkg.setRels(slide[SLIDE_PART_NAME], slideRels);
		}
		return;
	}
	const bytes = encode$1(serializeXml(buildCommentListDoc(comments)));
	const existing = pkg.getPart(commentsName);
	if (existing !== null) {
		existing.data = bytes;
		return;
	}
	pkg.addPart(commentsName, COMMENTS_CONTENT_TYPE, bytes);
	const slideRels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
	if (!slideRels.items.some((r) => r.type === REL_TYPES.comments)) {
		const slideN = slideNumberFromPartName(slide[SLIDE_PART_NAME]);
		slideRels.items.push({
			id: nextRelId(slideRels.items.map((r) => r.id)),
			type: REL_TYPES.comments,
			target: `../comments/comment${slideN}.xml`,
			targetMode: "Internal"
		});
		pkg.setRels(slide[SLIDE_PART_NAME], slideRels);
	}
};
const asCommentData = (slide, snap, author) => ({
	[COMMENT_SLIDE]: slide,
	[COMMENT_SNAPSHOT]: snap,
	author
});
/**
* Every author known to the package's `commentAuthors.xml`.
* Returns an empty array when no author list exists.
*/
const getCommentAuthors = (pres) => loadAuthorList(pres[INTERNAL_PACKAGE]);
/**
* Returns every slide that has at least one comment by the given
* author name. Accepts a literal string (exact-equality) or a
* `RegExp` for pattern matches. Sibling of `findCommentsByAuthor`
* (which returns the comments themselves).
*/
const findSlidesWithCommentsByAuthor = (pres, authorName) => {
	const matches = typeof authorName === "string" ? (n) => n === authorName : (n) => authorName.test(n);
	const out = [];
	for (const slide of getSlides(pres)) if (getSlideComments(slide).some((c) => matches(c.author.name))) out.push(slide);
	return out;
};
/**
* Returns every distinct author who has at least one comment
* anywhere in the deck. Deduplicates by author id; preserves
* first-seen order. Differs from `getCommentAuthors(pres)`, which
* surfaces every author registered in `commentAuthors.xml` even
* when no comments reference them.
*/
const getPresentationCommenters = (pres) => {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const slide of getSlides(pres)) for (const c of getSlideComments(slide)) {
		if (seen.has(c.author.id)) continue;
		seen.add(c.author.id);
		out.push(c.author);
	}
	return out;
};
/**
* Histogram of comment counts by author display name across the whole
* deck. Useful for "who reviewed this deck the most?" audits.
* Authors with the same display name (a real-world case for shared
* mailbox identities) get merged into the same bucket; pair with
* `getPresentationCommenters` when you need to keep authors with
* identical names separate by `id`.
*/
const getPresentationCommentCountsByAuthor = (pres) => {
	const counts = {};
	for (const slide of getSlides(pres)) for (const c of getSlideComments(slide)) {
		const name = c.author.name;
		counts[name] = (counts[name] ?? 0) + 1;
	}
	return counts;
};
/**
* Dense histogram of comment counts by 0-based slide index. Every
* slide in the deck appears as an element (count `0` when the slide
* has no comments), so the array shape is dense — handy for charting
* comment density per slide without re-indexing.
*/
const getPresentationCommentCountsBySlide = (pres) => {
	return getSlides(pres).map((s) => getSlideComments(s).length);
};
/**
* Looks up a `CommentAuthor` from `commentAuthors.xml` by display
* name. Accepts a literal string (exact equality) or a `RegExp` for
* pattern matches. Returns `null` when no author matches. Sibling of
* `findCommentsByAuthor` — the latter returns the matching comments;
* this returns the author handle for downstream metadata reads (id,
* initials, color).
*/
const findCommentAuthorByName = (pres, authorName) => {
	for (const a of getCommentAuthors(pres)) if (typeof authorName === "string" ? a.name === authorName : authorName.test(a.name)) return a;
	return null;
};
/**
* Returns every comment whose author name matches `authorName`
* across every slide in the deck. Accepts a literal string (exact-
* equality) or a `RegExp` for pattern matches — useful for reviewer-
* specific filters ("show me all of Alice's notes" / `/^review-bot/`).
*/
const findCommentsByAuthor = (pres, authorName) => {
	const out = [];
	for (const slide of getSlides(pres)) for (const c of getSlideComments(slide)) if (typeof authorName === "string" ? c.author.name === authorName : authorName.test(c.author.name)) out.push(c);
	return out;
};
/**
* Returns every comment whose text matches `needle` (substring or
* `RegExp`) across the whole deck. Sibling of `findCommentsByAuthor`
* — useful for "find every comment that mentions X" reviewer flows.
*/
const findCommentsByText = (pres, needle) => {
	const out = [];
	for (const slide of getSlides(pres)) for (const c of getSlideComments(slide)) {
		const text = c[COMMENT_SNAPSHOT].text;
		if (typeof needle === "string" ? text.includes(needle) : needle.test(text)) out.push(c);
	}
	return out;
};
/**
* Returns every comment whose `@dt` timestamp is **strictly after**
* `since` (an ISO-8601 string or `Date`). Comments missing a `dt`
* are skipped. Sibling of `findCommentsByText` / `findCommentsByAuthor`
* — useful for "what's new since my last review?" surfaces.
*/
const findCommentsAfter = (pres, since) => {
	const threshold = typeof since === "string" ? Date.parse(since) : since.getTime();
	if (Number.isNaN(threshold)) return [];
	const out = [];
	for (const slide of getSlides(pres)) for (const c of getSlideComments(slide)) {
		const dt = c[COMMENT_SNAPSHOT].dt;
		if (dt === null) continue;
		const t = Date.parse(dt);
		if (Number.isNaN(t)) continue;
		if (t > threshold) out.push(c);
	}
	return out;
};
/**
* Returns every comment whose `@dt` timestamp is **strictly before**
* `until` (an ISO-8601 string or `Date`). Comments missing a `dt`
* are skipped. Sibling of `findCommentsAfter`.
*/
const findCommentsBefore = (pres, until) => {
	const threshold = typeof until === "string" ? Date.parse(until) : until.getTime();
	if (Number.isNaN(threshold)) return [];
	const out = [];
	for (const slide of getSlides(pres)) for (const c of getSlideComments(slide)) {
		const dt = c[COMMENT_SNAPSHOT].dt;
		if (dt === null) continue;
		const t = Date.parse(dt);
		if (Number.isNaN(t)) continue;
		if (t < threshold) out.push(c);
	}
	return out;
};
const datedComments = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) for (const c of getSlideComments(slide)) {
		const dt = c[COMMENT_SNAPSHOT].dt;
		if (dt === null) continue;
		const t = Date.parse(dt);
		if (!Number.isNaN(t)) out.push({
			comment: c,
			t
		});
	}
	return out;
};
/**
* Returns every comment carrying a parseable `@dt`, sorted oldest
* to newest. Comments without a date are omitted. Use `.at(0)` for
* the oldest and `.at(-1)` for the newest.
*/
const getCommentsSortedByDate = (pres) => {
	const dated = [...datedComments(pres)];
	dated.sort((a, b) => a.t - b.t);
	return dated.map((d) => d.comment);
};
/**
* Returns the distinct authors who commented on this slide, in
* first-seen order. Dedupes by author id. Sibling of
* `getPresentationCommenters` for a slide-scoped reviewer roster.
*/
const getSlideCommentAuthors = (slide) => {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const c of getSlideComments(slide)) {
		if (seen.has(c.author.id)) continue;
		seen.add(c.author.id);
		out.push(c.author);
	}
	return out;
};
/**
* Returns every comment attached to the slide, with the author already
* resolved. The list is read-only — use `addSlideComment` /
* `removeSlideComment` to mutate.
*/
const getSlideComments = (slide) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const authors = loadAuthorList(pkg);
	const authorById = /* @__PURE__ */ new Map();
	for (const a of authors) authorById.set(a.id, a);
	const comments = loadCommentsForSlide(slide);
	const out = [];
	for (const snap of comments) {
		const author = authorById.get(snap.authorId);
		if (!author) {
			out.push(asCommentData(slide, snap, {
				id: snap.authorId,
				name: "",
				initials: "",
				lastIdx: snap.idx,
				clrIdx: null
			}));
			continue;
		}
		out.push(asCommentData(slide, snap, author));
	}
	return out;
};
/**
* Adds a comment to the slide. Returns the new comment handle.
*
* Author handling: if an author with the given `name`+`initials` already
* exists in `commentAuthors.xml`, the existing record is reused (and its
* `lastIdx` is bumped). Otherwise a new author is allocated. `initials`
* defaults to the first character of `name`.
*
* `position` is in EMU; pass `null` to omit the `<p:pos>` element.
* `date` defaults to the current time.
*/
const addSlideComment = (slide, opts) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const initials = opts.author.initials ?? (opts.author.name.length > 0 ? opts.author.name.charAt(0) : "?");
	const authors = loadAuthorList(pkg);
	let author = authors.find((a) => a.name === opts.author.name && a.initials === initials);
	if (!author) {
		let maxId = -1;
		for (const a of authors) if (a.id > maxId) maxId = a.id;
		author = {
			id: maxId + 1,
			name: opts.author.name,
			initials,
			lastIdx: 0,
			clrIdx: null
		};
		authors.push(author);
	}
	const newIdx = author.lastIdx + 1;
	const updatedAuthor = {
		...author,
		lastIdx: newIdx
	};
	writeAuthorList(pkg, authors.map((a) => a.id === author.id ? updatedAuthor : a));
	const dt = (opts.date ?? /* @__PURE__ */ new Date()).toISOString();
	const snap = {
		authorId: updatedAuthor.id,
		idx: newIdx,
		dt,
		text: opts.text,
		position: opts.position ?? null
	};
	const comments = loadCommentsForSlide(slide);
	comments.push(snap);
	writeCommentsForSlide(slide, comments);
	return asCommentData(slide, snap, updatedAuthor);
};
/**
* Removes the comment from its slide's comments part. If the comment
* was the last one on the slide, the comments part and the
* slide → comments rel are also removed. The author entry in
* `commentAuthors.xml` is left intact (an author may have comments on
* other slides).
*/
const removeSlideComment = (comment) => {
	const slide = comment[COMMENT_SLIDE];
	const target = comment[COMMENT_SNAPSHOT];
	writeCommentsForSlide(slide, loadCommentsForSlide(slide).filter((c) => !(c.authorId === target.authorId && c.idx === target.idx)));
};
/**
* Strips every comment from every slide in the deck. Returns the
* number of comments removed. Built on `writeCommentsForSlide`,
* so each slide's modern comment part is rewritten with an empty
* list. The `commentAuthors.xml` registry is left intact for any
* caller that still needs author identity.
*
* Useful as a sanitizer before sharing a draft externally — pairs
* with `clearAllSlideNotes` for a "remove reviewer chatter" pass.
*/
const clearAllSlideComments = (pres) => {
	let n = 0;
	for (const slide of getSlides(pres)) n += clearSlideComments(slide);
	return n;
};
/**
* Slide-scoped sibling of `clearAllSlideComments`. Removes every
* comment on the given slide and returns the number removed.
*/
const clearSlideComments = (slide) => {
	const comments = loadCommentsForSlide(slide);
	if (comments.length === 0) return 0;
	writeCommentsForSlide(slide, []);
	return comments.length;
};
const getCommentAuthor = (comment) => comment.author;
const getCommentText = (comment) => comment[COMMENT_SNAPSHOT].text;
const getCommentDate = (comment) => comment[COMMENT_SNAPSHOT].dt;
const getCommentPosition = (comment) => comment[COMMENT_SNAPSHOT].position;
/**
* Returns the slide that owns this comment. Counterpart to
* `getShapeSlide(shape)` — handy when filtering across the deck
* with `findCommentsByAuthor` and the caller needs to know which
* slide each hit came from.
*/
const getCommentSlide = (comment) => comment[COMMENT_SLIDE];
//#endregion
//#region src/api/fn/shape-image.ts
/**
* Computes the placed rectangle for an image inside a `(x, y, w, h)` box.
*
* For `'contain'` the image is scaled by the smaller of the two axis
* ratios so it fits entirely, then centered in the leftover space. When
* the natural size is unknown (non-PNG/JPEG, or an unreadable header)
* `naturalSize` is `null` and we fall back to `'fill'` — callers pass the
* raw bytes; measuring is best-effort, not a hard requirement.
*/
const fitImageRect = (box, fit, naturalSize) => {
	if (fit === "fill" || naturalSize === null) return box;
	const scale = Math.min(box.w / naturalSize.width, box.h / naturalSize.height);
	const w = Math.round(naturalSize.width * scale);
	const h = Math.round(naturalSize.height * scale);
	return {
		x: box.x + Math.round((box.w - w) / 2),
		y: box.y + Math.round((box.h - h) / 2),
		w,
		h
	};
};
/**
* Replaces a picture's media with `bytes`. Same-format replacements
* write in place; cross-format replacements allocate a new media part
* and repoint the rel. The geometry — crop, transform — is preserved.
*
* Pass `options.fit: 'contain'` to re-fit the picture's extent to the
* replacement image's aspect ratio, inscribed and centered in the shape's
* current `(off, ext)` box. The default `'fill'` leaves the extent as-is
* (the historical behavior). When the new image's natural size can't be
* measured (non-PNG/JPEG), `'contain'` is a no-op rather than an error.
*/
const setShapeImage = (shape, bytes, options = {}) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") throw new Error(`setShapeImage only works on picture shapes; ${shape[SHAPE_SNAPSHOT].kind} is not one`);
	const format = options.format ?? detectImageFormat(bytes);
	if (format === null) throw new Error("setShapeImage: could not detect image format. Pass options.format explicitly.");
	const rEmbed = getPictureEmbedRId(shape[SHAPE_ELEMENT]);
	if (rEmbed === null) throw new Error(`picture "${shape[SHAPE_SNAPSHOT].name}" has no r:embed`);
	const slide = shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (rels === null) throw new Error(`slide ${slide[SLIDE_PART_NAME]} has no rels`);
	const rel = rels.items.find((r) => r.id === rEmbed);
	if (!rel) throw new Error(`slide rels missing entry for r:embed="${rEmbed}"`);
	const mediaName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
	const newExtension = extensionForFormat(format);
	const newContentType = contentTypeForFormat(format);
	const dotIdx = mediaName.lastIndexOf(".");
	if ((dotIdx >= 0 ? mediaName.slice(dotIdx + 1).toLowerCase() : "") === newExtension) {
		const part = pkg.getPart(mediaName);
		if (!part) throw new Error(`media part missing: ${mediaName}`);
		part.data = bytes;
		part.contentType = newContentType;
	} else {
		let nextN = 1;
		const mediaPathRegex = /^\/ppt\/media\/image(\d+)\./;
		for (const p of pkg.parts) {
			const m = p.name.match(mediaPathRegex);
			if (m?.[1] !== void 0) {
				const num = Number.parseInt(m[1], 10);
				if (Number.isFinite(num) && num >= nextN) nextN = num + 1;
			}
		}
		const newPartName = partName(`/ppt/media/image${nextN}.${newExtension}`);
		if (!pkg.contentTypes.defaults.some((d) => d.extension.toLowerCase() === newExtension)) pkg.contentTypes.defaults.push({
			extension: newExtension,
			contentType: newContentType
		});
		pkg.addPart(newPartName, newContentType, bytes);
		rel.target = `../media/image${nextN}.${newExtension}`;
		pkg.setRels(slide[SLIDE_PART_NAME], rels);
	}
	if (options.fit === "contain") {
		const pos = readPosition(shape[SHAPE_ELEMENT], "picture");
		const size = readSize(shape[SHAPE_ELEMENT], "picture");
		const natural = readImagePixelSize(bytes);
		if (pos !== null && size !== null && natural !== null) {
			const fitted = fitImageRect({
				x: pos.x,
				y: pos.y,
				w: size.w,
				h: size.h
			}, "contain", natural);
			setPosition(shape[SHAPE_ELEMENT], "picture", fitted.x, fitted.y);
			setSize(shape[SHAPE_ELEMENT], "picture", fitted.w, fitted.h);
			commitSlideData(slide);
			refreshSlideData(slide);
		}
	}
};
//#endregion
//#region src/api/fn/shape-click-action.ts
const NAME_HLINK_CLICK_FN = qname("a", "hlinkClick", NS.dml);
const findCNvPr = (shape) => {
	const root = shape[SHAPE_ELEMENT];
	const kind = shape[SHAPE_SNAPSHOT].kind;
	const wrapperName = kind === "shape" ? "nvSpPr" : kind === "picture" ? "nvPicPr" : kind === "connector" ? "nvCxnSpPr" : kind === "graphicFrame" ? "nvGraphicFramePr" : null;
	if (wrapperName === null) return null;
	const wrapper = firstChildElement(root, qname("p", wrapperName, NS.pml));
	if (!wrapper) return null;
	return firstChildElement(wrapper, qname("p", "cNvPr", NS.pml));
};
const removeExistingHlinkClick = (cNvPr) => {
	cNvPr.children = cNvPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "hlinkClick"));
};
const findExistingHyperlinkRel = (rels, url) => {
	if (rels === null) return null;
	return rels.items.find((rl) => rl.type === REL_TYPES.hyperlink && rl.target === url && rl.targetMode === "External")?.id ?? null;
};
/**
* Reads the click action attached to the shape's cNvPr, or `null` if
* none. Mirrors `setShapeClickAction`:
*
*   - `{ kind: 'url', url }`     — `hyperlink` rel + targetMode=External
*   - `{ kind: 'slide', slide }` — `slide` rel + `ppaction://hlinksldjump`
*   - `{ kind: 'nextSlide' | 'prevSlide' | 'firstSlide' | 'lastSlide' }`
*     — preset show-navigation `ppaction`.
*
* For `kind: 'slide'`, the matching slide is resolved by part name.
* Returns `null` for unknown `ppaction` strings.
*/
const getShapeClickAction = (shape) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) return null;
	const hlink = firstChildElement(cNvPr, NAME_HLINK_CLICK_FN);
	if (!hlink) return null;
	const action = getAttrValue(hlink, qname("", "action", ""));
	const rId = getAttrValue(hlink, qname("r", "id", NS.officeDocRels));
	if (action === "ppaction://hlinkshowjump?jump=nextslide") return { kind: "nextSlide" };
	if (action === "ppaction://hlinkshowjump?jump=previousslide") return { kind: "prevSlide" };
	if (action === "ppaction://hlinkshowjump?jump=firstslide") return { kind: "firstSlide" };
	if (action === "ppaction://hlinkshowjump?jump=lastslide") return { kind: "lastSlide" };
	if (rId !== null && rId !== "") {
		const slide = shape[SHAPE_SLIDE];
		const pkg = slide[INTERNAL_PACKAGE];
		const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
		if (!rels) return null;
		const rel = rels.items.find((r) => r.id === rId);
		if (!rel) return null;
		if (action === "ppaction://hlinksldjump" && rel.type === REL_TYPES.slide) {
			const targetPartName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
			const pres = {
				[INTERNAL_PACKAGE]: pkg,
				_slidesCache: null
			};
			for (const candidate of getSlides(pres)) if (candidate[SLIDE_PART_NAME] === targetPartName) return {
				kind: "slide",
				slide: candidate
			};
			return null;
		}
		if (rel.type === REL_TYPES.hyperlink && rel.targetMode === "External") return {
			kind: "url",
			url: rel.target
		};
	}
	return null;
};
/**
* Sets (or clears) the click action on the shape. Side effects:
*
*   - For `kind: 'url'`, a `hyperlink` rel is added (or reused) on the
*     slide's rels with `targetMode="External"`. `<a:hlinkClick r:id=…/>`
*     points at it.
*   - For `kind: 'slide'`, a `slide` rel is added pointing at the
*     target slide's part. The `<a:hlinkClick>` carries
*     `action="ppaction://hlinksldjump"`.
*   - For the preset navigations (`nextSlide`, `prevSlide`, ...), no rel
*     is allocated; just the `action` attribute carries the preset.
*   - `null` removes any existing `<a:hlinkClick>`.
*
* The shape must be one of `shape | picture | connector | graphicFrame`.
* Groups don't carry their own click action in our model.
*/
const setShapeClickAction = (shape, action) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) throw new Error(`setShapeClickAction: ${shape[SHAPE_SNAPSHOT].kind} shape has no cNvPr to attach to`);
	removeExistingHlinkClick(cNvPr);
	if (action === null) {
		commitAndRefresh(shape);
		releaseUnusedLinkRels(shape[SHAPE_SLIDE]);
		return;
	}
	const slide = shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	let rId = null;
	let actionAttr = null;
	switch (action.kind) {
		case "url": {
			const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
			const reused = findExistingHyperlinkRel(rels, action.url);
			if (reused !== null) rId = reused;
			else {
				const newId = nextRelId(rels.items.map((r) => r.id));
				rels.items.push({
					id: newId,
					type: REL_TYPES.hyperlink,
					target: action.url,
					targetMode: "External"
				});
				pkg.setRels(slide[SLIDE_PART_NAME], rels);
				rId = newId;
			}
			break;
		}
		case "slide": {
			const target = action.slide[SLIDE_PART_NAME];
			const targetBase = basename(target);
			const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
			const existing = rels.items.find((rl) => rl.type === REL_TYPES.slide && rl.target === `../slides/${targetBase}` && rl.targetMode === "Internal");
			if (existing) rId = existing.id;
			else {
				const newId = nextRelId(rels.items.map((r) => r.id));
				rels.items.push({
					id: newId,
					type: REL_TYPES.slide,
					target: `../slides/${targetBase}`,
					targetMode: "Internal"
				});
				pkg.setRels(slide[SLIDE_PART_NAME], rels);
				rId = newId;
			}
			actionAttr = "ppaction://hlinksldjump";
			break;
		}
		case "nextSlide":
			actionAttr = "ppaction://hlinkshowjump?jump=nextslide";
			break;
		case "prevSlide":
			actionAttr = "ppaction://hlinkshowjump?jump=previousslide";
			break;
		case "firstSlide":
			actionAttr = "ppaction://hlinkshowjump?jump=firstslide";
			break;
		case "lastSlide":
			actionAttr = "ppaction://hlinkshowjump?jump=lastslide";
			break;
	}
	const attrs = [];
	if (rId !== null) attrs.push(attr(qname("r", "id", NS.officeDocRels), rId));
	else attrs.push(attr(qname("r", "id", NS.officeDocRels), ""));
	if (actionAttr !== null) attrs.push(attr(qname("", "action", ""), actionAttr));
	cNvPr.children.push(elem(NAME_HLINK_CLICK_FN, { attrs }));
	commitAndRefresh(shape);
	releaseUnusedLinkRels(slide);
};
//#endregion
//#region src/internal/chartml/enum-validation.ts
const LABEL_POSITIONS = [
	"ctr",
	"inEnd",
	"outEnd",
	"inBase",
	"t",
	"b",
	"l",
	"r",
	"bestFit"
];
const DISPLAY_UNITS = [
	"hundreds",
	"thousands",
	"tenThousands",
	"hundredThousands",
	"millions",
	"tenMillions",
	"hundredMillions",
	"billions",
	"trillions"
];
const LABEL_ALIGNMENTS = [
	"ctr",
	"l",
	"r"
];
const DISPLAY_BLANKS = [
	"gap",
	"zero",
	"span"
];
const SCATTER_STYLES = [
	"none",
	"line",
	"lineMarker",
	"marker",
	"smooth",
	"smoothMarker"
];
const RADAR_STYLES = [
	"standard",
	"marker",
	"filled"
];
const BAR_3D_SHAPES = [
	"box",
	"cone",
	"coneToMax",
	"cylinder",
	"pyramid",
	"pyramidToMax"
];
const OF_PIE_TYPES = ["pie", "bar"];
const SPLIT_TYPES = [
	"auto",
	"cust",
	"percent",
	"pos",
	"val"
];
const LAYOUT_TARGETS = ["inner", "outer"];
const AXIS_CROSSES = [
	"autoZero",
	"min",
	"max"
];
const LEGEND_POSITIONS = [
	"r",
	"t",
	"b",
	"l",
	"tr"
];
const MARKER_SYMBOLS = [
	"none",
	"auto",
	"circle",
	"square",
	"diamond",
	"triangle",
	"star",
	"x",
	"plus",
	"dash",
	"dot",
	"picture"
];
const TRENDLINE_TYPES = [
	"linear",
	"exp",
	"log",
	"poly",
	"power",
	"movingAvg"
];
const ERROR_BAR_TYPES = [
	"both",
	"plus",
	"minus"
];
const ERROR_VALUE_TYPES = [
	"fixedVal",
	"percentage",
	"stdDev",
	"stdErr",
	"cust"
];
const GROUPINGS = [
	"clustered",
	"stacked",
	"percentStacked",
	"standard"
];
const TICK_MARKS = [
	"in",
	"out",
	"cross",
	"none"
];
const TICK_LABEL_POSITIONS = [
	"none",
	"low",
	"high",
	"nextTo"
];
const ORIENTATIONS = ["minMax", "maxMin"];
const CROSS_BETWEEN = ["between", "midCat"];
const TIME_UNITS$1 = [
	"days",
	"months",
	"years"
];
const validateLabels = (labels, field) => {
	if (labels?.position !== void 0) oneOf(labels.position, LABEL_POSITIONS, `${field}.position`);
};
const validateScaling = (scaling, field) => {
	if (scaling?.displayUnits !== void 0) oneOf(scaling.displayUnits, DISPLAY_UNITS, `${field}.displayUnits`);
};
/** Validate before chart XML or its embedded workbook is changed. */
const validateChartSpecEnums = (spec, caller) => {
	oneOf(spec.kind, [
		"bar",
		"column",
		"line",
		"pie",
		"doughnut",
		"area",
		"scatter",
		"radar",
		"bubble",
		"stock",
		"surface"
	], `${caller}: kind`);
	if (spec.grouping !== void 0) oneOf(spec.grouping, GROUPINGS, `${caller}: grouping`);
	if (spec.valueAxisMajorTickMark !== void 0) oneOf(spec.valueAxisMajorTickMark, TICK_MARKS, `${caller}: valueAxisMajorTickMark`);
	if (spec.valueAxisMinorTickMark !== void 0) oneOf(spec.valueAxisMinorTickMark, TICK_MARKS, `${caller}: valueAxisMinorTickMark`);
	if (spec.categoryAxisMajorTickMark !== void 0) oneOf(spec.categoryAxisMajorTickMark, TICK_MARKS, `${caller}: categoryAxisMajorTickMark`);
	if (spec.categoryAxisMinorTickMark !== void 0) oneOf(spec.categoryAxisMinorTickMark, TICK_MARKS, `${caller}: categoryAxisMinorTickMark`);
	if (spec.valueAxisTickLabelPos !== void 0) oneOf(spec.valueAxisTickLabelPos, TICK_LABEL_POSITIONS, `${caller}: valueAxisTickLabelPos`);
	if (spec.categoryAxisTickLabelPos !== void 0) oneOf(spec.categoryAxisTickLabelPos, TICK_LABEL_POSITIONS, `${caller}: categoryAxisTickLabelPos`);
	if (spec.categoryAxisLabelAlign !== void 0) oneOf(spec.categoryAxisLabelAlign, LABEL_ALIGNMENTS, `${caller}: categoryAxisLabelAlign`);
	if (spec.categoryAxisOrientation !== void 0) oneOf(spec.categoryAxisOrientation, ORIENTATIONS, `${caller}: categoryAxisOrientation`);
	if (spec.valueAxisOrientation !== void 0) oneOf(spec.valueAxisOrientation, ORIENTATIONS, `${caller}: valueAxisOrientation`);
	if (spec.valueAxisCrossBetween !== void 0) oneOf(spec.valueAxisCrossBetween, CROSS_BETWEEN, `${caller}: valueAxisCrossBetween`);
	if (spec.dispBlanksAs !== void 0) oneOf(spec.dispBlanksAs, DISPLAY_BLANKS, `${caller}: dispBlanksAs`);
	if (spec.scatterStyle !== void 0) oneOf(spec.scatterStyle, SCATTER_STYLES, `${caller}: scatterStyle`);
	if (spec.radarStyle !== void 0) oneOf(spec.radarStyle, RADAR_STYLES, `${caller}: radarStyle`);
	if (spec.bubbleSizeRepresents !== void 0) oneOf(spec.bubbleSizeRepresents, ["area", "width"], `${caller}: bubbleSizeRepresents`);
	if (spec.bar3DShape !== void 0) oneOf(spec.bar3DShape, BAR_3D_SHAPES, `${caller}: bar3DShape`);
	if (spec.secondaryValueAxis?.majorTickMark !== void 0) oneOf(spec.secondaryValueAxis.majorTickMark, TICK_MARKS, `${caller}: secondaryValueAxis.majorTickMark`);
	if (spec.secondaryValueAxis?.minorTickMark !== void 0) oneOf(spec.secondaryValueAxis.minorTickMark, TICK_MARKS, `${caller}: secondaryValueAxis.minorTickMark`);
	if (spec.secondaryValueAxis?.tickLabelPos !== void 0) oneOf(spec.secondaryValueAxis.tickLabelPos, TICK_LABEL_POSITIONS, `${caller}: secondaryValueAxis.tickLabelPos`);
	if (spec.secondaryValueAxis?.crossBetween !== void 0) oneOf(spec.secondaryValueAxis.crossBetween, CROSS_BETWEEN, `${caller}: secondaryValueAxis.crossBetween`);
	if (spec.seriesAxis?.orientation !== void 0) oneOf(spec.seriesAxis.orientation, ORIENTATIONS, `${caller}: seriesAxis.orientation`);
	if (spec.seriesAxis?.tickLabelPos !== void 0) oneOf(spec.seriesAxis.tickLabelPos, TICK_LABEL_POSITIONS, `${caller}: seriesAxis.tickLabelPos`);
	if (spec.categoryAxisDate?.baseTimeUnit !== void 0) oneOf(spec.categoryAxisDate.baseTimeUnit, TIME_UNITS$1, `${caller}: categoryAxisDate.baseTimeUnit`);
	if (spec.categoryAxisDate?.majorTimeUnit !== void 0) oneOf(spec.categoryAxisDate.majorTimeUnit, TIME_UNITS$1, `${caller}: categoryAxisDate.majorTimeUnit`);
	if (spec.categoryAxisDate?.minorTimeUnit !== void 0) oneOf(spec.categoryAxisDate.minorTimeUnit, TIME_UNITS$1, `${caller}: categoryAxisDate.minorTimeUnit`);
	if (spec.ofPie?.type !== void 0) oneOf(spec.ofPie.type, OF_PIE_TYPES, `${caller}: ofPie.type`);
	if (spec.ofPie?.splitType !== void 0) oneOf(spec.ofPie.splitType, SPLIT_TYPES, `${caller}: ofPie.splitType`);
	if (spec.plotAreaLayout?.target !== void 0) oneOf(spec.plotAreaLayout.target, LAYOUT_TARGETS, `${caller}: plotAreaLayout.target`);
	if (spec.legend?.layout?.target !== void 0) oneOf(spec.legend.layout.target, LAYOUT_TARGETS, `${caller}: legend.layout.target`);
	if (spec.valueAxisCrosses !== void 0 && typeof spec.valueAxisCrosses !== "object") oneOf(spec.valueAxisCrosses, AXIS_CROSSES, `${caller}: valueAxisCrosses`);
	if (spec.legend?.position != null) oneOf(spec.legend.position, LEGEND_POSITIONS, `${caller}: legend.position`);
	validateLabels(spec.dataLabels, `${caller}: dataLabels`);
	validateScaling(spec.valueAxis, `${caller}: valueAxis`);
	validateScaling(spec.categoryAxisScaling, `${caller}: categoryAxisScaling`);
	validateScaling(spec.secondaryValueAxis?.scaling, `${caller}: secondaryValueAxis.scaling`);
	for (const [index, series] of spec.series.entries()) {
		const field = `${caller}: series[${index}]`;
		if (series.chartKind !== void 0) oneOf(series.chartKind, [
			"bar",
			"column",
			"line",
			"area"
		], `${field}.chartKind`);
		if (series.lineDash !== void 0) oneOf(series.lineDash, LINE_DASHES, `${field}.lineDash`);
		if (series.markerSymbol !== void 0) oneOf(series.markerSymbol, MARKER_SYMBOLS, `${field}.markerSymbol`);
		if (series.trendline !== void 0) oneOf(series.trendline.type, TRENDLINE_TYPES, `${field}.trendline.type`);
		validateLabels(series.dataLabels, `${field}.dataLabels`);
		for (const [point, labels] of (series.pointDataLabels ?? []).entries()) validateLabels(labels, `${field}.pointDataLabels[${point}]`);
		for (const direction of ["errorBars", "xErrorBars"]) {
			const bars = series[direction];
			if (bars === void 0) continue;
			oneOf(bars.barType, ERROR_BAR_TYPES, `${field}.${direction}.barType`);
			oneOf(bars.amount.type, ERROR_VALUE_TYPES, `${field}.${direction}.amount.type`);
		}
	}
};
//#endregion
//#region src/internal/chartml/chart-spec.ts
/** Fields every chart kind carries. */
const COMMON_FIELDS = [
	"categories",
	"title",
	"titleStyle",
	"titleOverlay",
	"titleLayout",
	"dataLabels",
	"legend",
	"plotAreaLayout",
	"plotAreaFill",
	"plotAreaStrokeColor",
	"chartAreaFill",
	"chartAreaStrokeColor",
	"plotVisibleCellsOnly",
	"dispBlanksAs",
	"date1904",
	"language",
	"roundedCorners",
	"chartStyle",
	"varyColors"
];
/** `<c:valAx>` — on every kind but the axis-less pie / doughnut. */
const VALUE_AXIS_FIELDS = [
	"valueAxis",
	"valueAxisTitle",
	"valueAxisTitleStyle",
	"valueAxisTitleRotationDeg",
	"valueAxisLabelStyle",
	"valueAxisLabelRotationDeg",
	"valueAxisHidden",
	"valueAxisMajorGridlines",
	"valueAxisMinorGridlines",
	"valueAxisMajorGridlineColor",
	"valueAxisMinorGridlineColor",
	"valueAxisMajorGridlineWidthEmu",
	"valueAxisMinorGridlineWidthEmu",
	"valueAxisMajorTickMark",
	"valueAxisMinorTickMark",
	"valueAxisTickLabelPos",
	"valueAxisLineColor",
	"valueAxisLineWidthEmu",
	"valueAxisLineHidden",
	"valueAxisOrientation",
	"valueAxisCrosses",
	"valueAxisCrossBetween"
];
/**
* The horizontal axis. One set of fields drives `<c:catAx>` on a category
* chart and the x-channel `<c:valAx>` of a scatter / bubble chart.
*/
const HORIZONTAL_AXIS_FIELDS = [
	"categoryAxisTitle",
	"categoryAxisTitleStyle",
	"categoryAxisTitleRotationDeg",
	"categoryAxisLabelStyle",
	"categoryAxisLabelRotationDeg",
	"categoryAxisHidden",
	"categoryAxisMajorGridlines",
	"categoryAxisMinorGridlines",
	"categoryAxisMajorGridlineColor",
	"categoryAxisMinorGridlineColor",
	"categoryAxisMajorGridlineWidthEmu",
	"categoryAxisMinorGridlineWidthEmu",
	"categoryAxisMajorTickMark",
	"categoryAxisMinorTickMark",
	"categoryAxisTickLabelPos",
	"categoryAxisLineColor",
	"categoryAxisLineWidthEmu",
	"categoryAxisLineHidden",
	"categoryAxisOrientation",
	"categoryAxisNumberFormat"
];
/** Tick and label controls only a discrete category axis has. */
const CATEGORY_AXIS_FIELDS = [
	"categoryAxisTickLabelSkip",
	"categoryAxisTickMarkSkip",
	"categoryAxisLabelOffset",
	"categoryAxisLabelAlign",
	"categoryAxisNoMultiLevelLabel"
];
/** The three fields {@link CategoryAxisMode} arbitrates between. */
const CATEGORY_MODE_FIELDS = [
	"categoryAxisDate",
	"categoryAxisScaling",
	"categoryGroupLevels"
];
/** Every field of a chart that has axes. */
const AXIS_CHART_FIELDS = [
	...COMMON_FIELDS,
	...VALUE_AXIS_FIELDS,
	...HORIZONTAL_AXIS_FIELDS
];
/** Every field of a chart drawn against a discrete category axis. */
const CATEGORY_CHART_FIELDS = [
	...AXIS_CHART_FIELDS,
	...CATEGORY_AXIS_FIELDS,
	...CATEGORY_MODE_FIELDS,
	"dataTable"
];
/** Per-variant field sets; the variant types below are derived from these. */
const VARIANT_FIELDS = {
	combo: [
		...CATEGORY_CHART_FIELDS,
		"grouping",
		"gapWidthPct",
		"overlapPct",
		"dropLines",
		"hiLowLines",
		"lineMarkers",
		"upDownBars",
		"secondaryValueAxis"
	],
	bar3D: [
		...CATEGORY_CHART_FIELDS,
		"grouping",
		"gapWidthPct",
		"gapDepthPct",
		"bar3DShape",
		"seriesAxis",
		"view3D"
	],
	lineArea3D: [
		...CATEGORY_CHART_FIELDS,
		"grouping",
		"dropLines",
		"gapDepthPct",
		"seriesAxis",
		"view3D"
	],
	pie: [...COMMON_FIELDS, "firstSliceAngleDeg"],
	ofPie: [...COMMON_FIELDS, "ofPie"],
	pie3D: [...COMMON_FIELDS, "view3D"],
	doughnut: [
		...COMMON_FIELDS,
		"firstSliceAngleDeg",
		"holeSizePct"
	],
	scatter: [
		...AXIS_CHART_FIELDS,
		"categoryAxisScaling",
		"scatterStyle"
	],
	bubble: [
		...AXIS_CHART_FIELDS,
		"categoryAxisScaling",
		"bubbleScale",
		"bubbleSizeRepresents",
		"bubble3D",
		"showNegativeBubbles"
	],
	radar: [...CATEGORY_CHART_FIELDS, "radarStyle"],
	stock: [
		...CATEGORY_CHART_FIELDS,
		"dropLines",
		"hiLowLines"
	],
	candlestick: [
		...CATEGORY_CHART_FIELDS,
		"dropLines",
		"hiLowLines",
		"upDownBars"
	],
	surface: [
		...CATEGORY_CHART_FIELDS,
		"surfaceContour",
		"surfaceWireframe",
		"view3D",
		"seriesAxis"
	]
};
const fieldSet = (fields) => new Set(fields);
const VARIANT_FIELD_SETS = {
	combo: fieldSet(VARIANT_FIELDS.combo),
	bar3D: fieldSet(VARIANT_FIELDS.bar3D),
	lineArea3D: fieldSet(VARIANT_FIELDS.lineArea3D),
	pie: fieldSet(VARIANT_FIELDS.pie),
	ofPie: fieldSet(VARIANT_FIELDS.ofPie),
	pie3D: fieldSet(VARIANT_FIELDS.pie3D),
	doughnut: fieldSet(VARIANT_FIELDS.doughnut),
	scatter: fieldSet(VARIANT_FIELDS.scatter),
	bubble: fieldSet(VARIANT_FIELDS.bubble),
	radar: fieldSet(VARIANT_FIELDS.radar),
	stock: fieldSet(VARIANT_FIELDS.stock),
	candlestick: fieldSet(VARIANT_FIELDS.candlestick),
	surface: fieldSet(VARIANT_FIELDS.surface)
};
/**
* Which arm of {@link ChartSpec} a spec would inhabit, from the fields that
* pick the OOXML element. It says nothing about whether the rest of the
* spec fits — {@link isChartSpec} decides that.
*/
const chartVariant = (spec) => {
	switch (spec.kind) {
		case "bar":
		case "column": return spec.view3D !== void 0 ? "bar3D" : "combo";
		case "line":
		case "area": return spec.view3D !== void 0 ? "lineArea3D" : "combo";
		case "pie":
			if (spec.view3D !== void 0) return "pie3D";
			return spec.ofPie !== void 0 ? "ofPie" : "pie";
		case "stock": return spec.series.length === 4 ? "candlestick" : "stock";
		default: return spec.kind;
	}
};
const SINGLE_SERIES_VARIANTS = new Set([
	"pie",
	"ofPie",
	"pie3D",
	"doughnut"
]);
const seriesFits = (spec, variant) => {
	if (SINGLE_SERIES_VARIANTS.has(variant) && spec.series.length !== 1) return false;
	if (variant === "stock" && spec.series.length !== 3) return false;
	if (variant === "candlestick" && spec.series.length !== 4) return false;
	const wantsX = variant === "scatter" || variant === "bubble";
	return spec.series.every((series) => series.xValues !== void 0 === wantsX && series.bubbleSizes !== void 0 === (variant === "bubble") && (variant === "combo" || series.chartKind === void 0 && series.secondaryAxis === void 0));
};
/**
* Whether a spec read back from a deck also inhabits the write-side
* {@link ChartSpec}. A deck authored elsewhere can combine fields no kind
* draws, so a read-modify-write pass has to narrow before it writes.
*/
const isChartSpec = (spec) => {
	const variant = chartVariant(spec);
	const allowed = VARIANT_FIELD_SETS[variant];
	for (const [field, value] of Object.entries(spec)) {
		if (field === "kind" || field === "series" || value === void 0) continue;
		if (!allowed.has(field)) return false;
	}
	if (spec.categoryAxisDate === void 0) {
		if (spec.categoryAxisScaling !== void 0 && spec.kind !== "scatter" && spec.kind !== "bubble") return false;
	} else if (spec.categoryGroupLevels !== void 0) return false;
	return seriesFits(spec, variant);
};
new Set(Object.values(VARIANT_FIELDS).flat());
//#endregion
//#region src/internal/chartml/embedded-xlsx.ts
const TEXT_ENCODER = new TextEncoder();
const encode = (s) => TEXT_ENCODER.encode(s);
const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colLetter = (col) => {
	let n = col;
	let out = "";
	while (true) {
		out = String.fromCharCode(65 + n % 26) + out;
		if (n < 26) return out;
		n = Math.floor(n / 26) - 1;
	}
};
const cellRef = (row, col) => `${colLetter(col)}${row + 1}`;
/**
* Builds the bytes of a fresh xlsx whose only sheet holds `grid`, row by
* row from A1. Which cell means what is the caller's business — see
* `layoutChartSheet`, which also produces the `<c:f>` formulas that point
* back into this grid.
*/
const buildEmbeddedXlsx = (grid) => {
	const sheetXmlParts = [];
	sheetXmlParts.push("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">", "<sheetData>");
	grid.forEach((row, r) => {
		sheetXmlParts.push(`<row r="${r + 1}">`);
		row.forEach((cell, col) => {
			if (cell === null) return;
			sheetXmlParts.push(typeof cell === "number" ? `<c r="${cellRef(r, col)}"><v>${cell}</v></c>` : `<c r="${cellRef(r, col)}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`);
		});
		sheetXmlParts.push("</row>");
	});
	sheetXmlParts.push("</sheetData></worksheet>");
	const sheetXml = sheetXmlParts.join("");
	return writeZip([
		{
			name: "[Content_Types].xml",
			data: encode("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>")
		},
		{
			name: "_rels/.rels",
			data: encode("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>")
		},
		{
			name: "xl/workbook.xml",
			data: encode("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>")
		},
		{
			name: "xl/_rels/workbook.xml.rels",
			data: encode("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>")
		},
		{
			name: "xl/worksheets/sheet1.xml",
			data: encode(sheetXml)
		}
	]);
};
/**
* Returns the spreadsheet-cell reference span used by chart `<c:f>`
* formulas. Example: `cellRange('Sheet1', 1, 0, 4)` →
* `"Sheet1!$A$2:$A$5"` (column A, rows 2–5 inclusive, 0-indexed input).
*/
const cellRange = (sheet, startRow, col, count, endCol = col) => `${sheet}!$${colLetter(col)}$${startRow + 1}:$${colLetter(endCol)}$${startRow + count}`;
/** Single-cell reference, e.g. `cellAddr('Sheet1', 0, 1)` → `"Sheet1!$B$1"`. */
const cellAddr = (sheet, row, col) => `${sheet}!$${colLetter(col)}$${row + 1}`;
//#endregion
//#region src/internal/chartml/sheet-layout.ts
const SHEET = "Sheet1";
const isXyKind = (spec) => spec.kind === "scatter" || spec.kind === "bubble";
/** Parses a date-axis category; the caller has validated it is numeric. */
const dateSerial = (category) => Number(category);
const layoutCategorySheet = (spec) => {
	const outerLevels = [...spec.categoryGroupLevels ?? []].reverse();
	const levelCount = outerLevels.length + 1;
	const rowCount = spec.categories.length;
	const isDateAxis = spec.categoryAxisDate !== void 0;
	const grid = [[...Array.from({ length: levelCount }, () => ""), ...spec.series.map((s) => s.name)]];
	for (let r = 0; r < rowCount; r++) {
		const category = spec.categories[r] ?? "";
		const row = outerLevels.map((level) => {
			const label = level[r] ?? "";
			return label === "" ? null : label;
		});
		row.push(isDateAxis ? dateSerial(category) : category);
		for (const s of spec.series) row.push(s.values[r] ?? null);
		grid.push(row);
	}
	return {
		grid,
		categories: cellRange(SHEET, 1, 0, rowCount, levelCount - 1),
		series: spec.series.map((_, i) => ({
			name: cellAddr(SHEET, 0, levelCount + i),
			values: cellRange(SHEET, 1, levelCount + i, rowCount)
		}))
	};
};
const layoutXySheet = (spec) => {
	const isBubble = spec.kind === "bubble";
	const stride = isBubble ? 3 : 2;
	const rowCount = Math.max(0, ...spec.series.map((s) => Math.max(s.values.length, s.xValues?.length ?? 0, s.bubbleSizes?.length ?? 0)));
	const header = [];
	for (const s of spec.series) {
		header.push("X", s.name);
		if (isBubble) header.push("Size");
	}
	const grid = [header];
	for (let r = 0; r < rowCount; r++) {
		const row = [];
		for (const s of spec.series) {
			row.push(s.xValues?.[r] ?? null, s.values[r] ?? null);
			if (isBubble) row.push(s.bubbleSizes?.[r] ?? null);
		}
		grid.push(row);
	}
	return {
		grid,
		series: spec.series.map((s, i) => {
			const base = i * stride;
			const pointCount = s.values.length;
			return {
				name: cellAddr(SHEET, 0, base + 1),
				xValues: cellRange(SHEET, 1, base, pointCount),
				values: cellRange(SHEET, 1, base + 1, pointCount),
				...isBubble ? { bubbleSizes: cellRange(SHEET, 1, base + 2, pointCount) } : {}
			};
		})
	};
};
/** Lays `spec` out as a sheet grid plus the formulas that address it. */
const layoutChartSheet = (spec) => isXyKind(spec) ? layoutXySheet(spec) : layoutCategorySheet(spec);
//#endregion
//#region src/internal/chartml/chart-builder.ts
const NS_C$1 = NS.chart;
const NS_A$1 = NS.dml;
const NS_R = NS.officeDocRels;
const c = (local) => qname("c", local, NS_C$1);
const a = (local) => qname("a", local, NS_A$1);
const r = (local) => qname("r", local, NS_R);
const ATTR_VAL$1 = qname("", "val", "");
const ATTR_IDX$1 = qname("", "idx", "");
const valNode = (name, val) => elem(name, { attrs: [attr(ATTR_VAL$1, String(val))] });
const ptNode = (idx, value) => elem(c("pt"), {
	attrs: [attr(ATTR_IDX$1, String(idx))],
	children: [elem(c("v"), { children: [text(value)] })]
});
const strRef = (formula, points) => {
	const strCache = elem(c("strCache"), { children: [valNode(c("ptCount"), points.length), ...points.map((p, i) => ptNode(i, p))] });
	return elem(c("strRef"), { children: [elem(c("f"), { children: [text(formula)] }), strCache] });
};
const numDataChildren = (points, formatCode) => [
	elem(c("formatCode"), { children: [text(formatCode)] }),
	valNode(c("ptCount"), points.length),
	...points.map((v, i) => v === null ? null : ptNode(i, String(v))).filter((n) => n !== null)
];
const numRef = (formula, points, formatCode = "General") => elem(c("numRef"), { children: [elem(c("f"), { children: [text(formula)] }), elem(c("numCache"), { children: numDataChildren(points, formatCode) })] });
const multiLvlStrRef = (formula, levels, pointCount) => elem(c("multiLvlStrRef"), { children: [elem(c("f"), { children: [text(formula)] }), elem(c("multiLvlStrCache"), { children: [valNode(c("ptCount"), pointCount), ...levels.map((level, depth) => elem(c("lvl"), { children: level.map((label, i) => depth > 0 && label === "" ? null : ptNode(i, label)).filter((n) => n !== null) }))] })] });
const hexOf = (color) => color.replace(/^#/, "").toUpperCase();
const solidFill = (color, opacity) => elem(a("solidFill"), { children: [elem(a("srgbClr"), {
	attrs: [attr(ATTR_VAL$1, hexOf(color))],
	children: opacity !== void 0 ? [valNode(a("alpha"), boundedInt(opacity * 1e5, "percent100000", "chart series: fillOpacity"))] : []
})] });
const solidFillSpPr = (color, opacity) => elem(c("spPr"), { children: [solidFill(color, opacity)] });
const lineSpPr = (color, widthEmu, field, hidden = false) => {
	if (hidden) return elem(c("spPr"), { children: [elem(a("ln"), { children: [elem(a("noFill"))] })] });
	if (color === void 0 && widthEmu === void 0) return null;
	const ln = elem(a("ln"), {
		attrs: widthEmu !== void 0 ? [attr(qname("", "w", ""), String(lineWidthEmu(widthEmu, field)))] : [],
		children: color !== void 0 ? [elem(a("solidFill"), { children: [elem(a("srgbClr"), { attrs: [attr(qname("", "val", ""), color.replace(/^#/, "").toUpperCase())] })] })] : []
	});
	return elem(c("spPr"), { children: [ln] });
};
const gridlinesElement = (local, color, widthEmu, field) => {
	const spPr = lineSpPr(color, widthEmu, field);
	return spPr === null ? elem(c(local)) : elem(c(local), { children: [spPr] });
};
const spPrChildren = (fill, stroke) => {
	const out = [];
	if (fill !== void 0) out.push(elem(a("solidFill"), { children: [elem(a("srgbClr"), { attrs: [attr(qname("", "val", ""), fill.replace(/^#/, "").toUpperCase())] })] }));
	if (stroke !== void 0) out.push(elem(a("ln"), { children: [elem(a("solidFill"), { children: [elem(a("srgbClr"), { attrs: [attr(qname("", "val", ""), stroke.replace(/^#/, "").toUpperCase())] })] })] }));
	return elem(c("spPr"), { children: out });
};
const DEFAULT_ACCENT_COLORS = [
	"4472C4",
	"ED7D31",
	"A5A5A5",
	"FFC000",
	"5B9BD5",
	"70AD47"
];
const seriesSpPr = (color, lineColor, lineWidthEmu$1, lineDash, fillOpacity) => {
	const lnChildren = [lineColor === null ? elem(a("noFill")) : solidFill(lineColor)];
	if (lineColor !== null && lineDash !== void 0) lnChildren.push(elem(a("prstDash"), { attrs: [attr(qname("", "val", ""), lineDash)] }));
	const ln = lineWidthEmu$1 !== void 0 ? elem(a("ln"), {
		attrs: [attr(qname("", "w", ""), String(lineWidthEmu(lineWidthEmu$1, "chart series: lineWidthEmu")))],
		children: lnChildren
	}) : elem(a("ln"), { children: lnChildren });
	return elem(c("spPr"), { children: [solidFill(color, fillOpacity), ln] });
};
const markerElement = (symbol, sizePt, color, lineColor) => {
	const children = [];
	if (symbol !== void 0) children.push(valNode(c("symbol"), symbol));
	if (sizePt !== void 0) children.push(valNode(c("size"), Math.round(sizePt)));
	if (symbol !== "none") {
		const fill = (hex) => elem(a("solidFill"), { children: [elem(a("srgbClr"), { attrs: [attr(qname("", "val", ""), hex)] })] });
		children.push(elem(c("spPr"), { children: [fill(color), elem(a("ln"), { children: [fill(lineColor)] })] }));
	}
	return elem(c("marker"), { children });
};
const dPtElements = (colors, explosions, fillOpacity, bubble3D) => {
	const out = [];
	const colorLen = colors?.length ?? 0;
	const explLen = explosions?.length ?? 0;
	const max = Math.max(colorLen, explLen);
	for (let i = 0; i < max; i++) {
		const color = colors?.[i] ?? null;
		const expl = explosions?.[i] ?? null;
		if (color === null && (expl === null || !Number.isFinite(expl))) continue;
		const children = [valNode(c("idx"), i), valNode(c("bubble3D"), bubble3D ? "1" : "0")];
		if (expl !== null) children.push(valNode(c("explosion"), Math.round(expl)));
		if (color !== null) children.push(solidFillSpPr(color, fillOpacity));
		out.push(elem(c("dPt"), { children }));
	}
	return out;
};
const trendlineElement = (tl) => {
	const children = [];
	if (tl.name !== void 0) children.push(elem(c("name"), { children: [text(tl.name)] }));
	if (tl.color !== void 0) {
		const hex = tl.color.replace(/^#/, "").toUpperCase();
		const ln = elem(a("ln"), { children: [elem(a("solidFill"), { children: [elem(a("srgbClr"), { attrs: [attr(qname("", "val", ""), hex)] })] })] });
		children.push(elem(c("spPr"), { children: [ln] }));
	}
	children.push(valNode(c("trendlineType"), tl.type));
	if (tl.type === "movingAvg" && tl.period !== void 0) children.push(valNode(c("period"), tl.period));
	if (tl.type === "poly" && tl.order !== void 0) children.push(valNode(c("order"), tl.order));
	if (tl.forward !== void 0) children.push(valNode(c("forward"), tl.forward));
	if (tl.backward !== void 0) children.push(valNode(c("backward"), tl.backward));
	if (tl.displayRSquared) children.push(valNode(c("dispRSqr"), "1"));
	if (tl.displayEquation) children.push(valNode(c("dispEq"), "1"));
	return elem(c("trendline"), { children });
};
const errBarsElement = (bars, direction) => {
	const children = [];
	if (direction !== null) children.push(valNode(c("errDir"), direction));
	children.push(valNode(c("errBarType"), bars.barType), valNode(c("errValType"), bars.amount.type));
	if (bars.noEndCap !== void 0) children.push(valNode(c("noEndCap"), bars.noEndCap ? "1" : "0"));
	if (bars.amount.type === "cust") {
		const literal = (name, points) => elem(c(name), { children: [elem(c("numLit"), { children: numDataChildren(points, "General") })] });
		if (bars.amount.plus !== void 0) children.push(literal("plus", bars.amount.plus));
		if (bars.amount.minus !== void 0) children.push(literal("minus", bars.amount.minus));
	} else if (bars.amount.type !== "stdErr") children.push(valNode(c("val"), bars.amount.value));
	const spPr = lineSpPr(bars.color, bars.lineWidthEmu, "chart series: errorBars.lineWidthEmu");
	if (spPr !== null) children.push(spPr);
	return elem(c("errBars"), { children });
};
const SERIES_SHAPE = {
	bar: "bar",
	column: "bar",
	line: "line",
	stock: "line",
	area: "area",
	pie: "pie",
	doughnut: "pie",
	scatter: "scatter",
	bubble: "bubble",
	radar: "radar",
	surface: "surface"
};
const SHAPES_WITH_MARKER = new Set([
	"line",
	"scatter",
	"radar"
]);
const SHAPES_WITH_TRENDLINE = new Set([
	"bar",
	"line",
	"area",
	"scatter",
	"bubble"
]);
const SHAPES_WITH_ERR_BARS = SHAPES_WITH_TRENDLINE;
const SHAPES_WITH_INVERT = new Set(["bar", "bubble"]);
const SCATTER_STYLES_WITH_LINE = new Set([
	"line",
	"lineMarker",
	"smooth",
	"smoothMarker"
]);
const SCATTER_STYLES_WITH_MARKER = new Set([
	"marker",
	"lineMarker",
	"smoothMarker"
]);
const categoryChannel = (spec, formula) => {
	if (spec.categoryAxisDate !== void 0) return elem(c("cat"), { children: [numRef(formula, spec.categories.map(dateSerial), spec.categoryAxisNumberFormat ?? "General")] });
	if (spec.categoryGroupLevels !== void 0 && spec.categoryGroupLevels.length > 0) return elem(c("cat"), { children: [multiLvlStrRef(formula, [spec.categories, ...spec.categoryGroupLevels], spec.categories.length)] });
	return elem(c("cat"), { children: [strRef(formula, spec.categories)] });
};
const padTo = (values, length) => Array.from({ length }, (_, i) => values?.[i] ?? null);
const seriesElement = (spec, seriesIdx, layout) => {
	const series = spec.series[seriesIdx];
	const refs = layout.series[seriesIdx];
	if (!series || !refs) throw new Error("seriesElement: out of range");
	const color = series.color !== void 0 ? hexOf(series.color) : DEFAULT_ACCENT_COLORS[seriesIdx % DEFAULT_ACCENT_COLORS.length] ?? "4472C4";
	const kind = series.chartKind ?? spec.kind;
	const shape = SERIES_SHAPE[kind];
	const children = [
		valNode(c("idx"), seriesIdx),
		valNode(c("order"), seriesIdx),
		elem(c("tx"), { children: [strRef(refs.name, [series.name])] })
	];
	const isXy = shape === "scatter" || shape === "bubble";
	const pointCount = isXy ? series.values.length : spec.categories.length;
	const channels = [];
	if (isXy) {
		if (refs.xValues === void 0) throw new Error("seriesElement: xy series without an x range");
		channels.push(elem(c("xVal"), { children: [numRef(refs.xValues, padTo(series.xValues, pointCount))] }), elem(c("yVal"), { children: [numRef(refs.values, padTo(series.values, pointCount))] }));
		if (shape === "bubble") {
			if (refs.bubbleSizes === void 0) throw new Error("seriesElement: bubble series without a size range");
			channels.push(elem(c("bubbleSize"), { children: [numRef(refs.bubbleSizes, padTo(series.bubbleSizes, pointCount))] }), valNode(c("bubble3D"), spec.bubble3D === true ? "1" : "0"));
		}
	} else {
		if (layout.categories === void 0) throw new Error("seriesElement: category series without a category range");
		channels.push(categoryChannel(spec, layout.categories), elem(c("val"), { children: [numRef(refs.values, padTo(series.values, pointCount))] }));
	}
	if (shape === "surface") return elem(c("ser"), { children: [...children, ...channels] });
	const scatterStyle = spec.scatterStyle ?? "marker";
	const lineHidden = spec.kind === "stock" || shape === "scatter" && !SCATTER_STYLES_WITH_LINE.has(scatterStyle);
	if (lineHidden || shape === "line" || shape === "scatter" || shape === "radar" || series.lineWidthEmu !== void 0 || series.lineColor !== void 0 || series.lineDash !== void 0) {
		const lineColor = lineHidden ? null : series.lineColor !== void 0 ? hexOf(series.lineColor) : color;
		children.push(seriesSpPr(color, lineColor, series.lineWidthEmu, series.lineDash, series.fillOpacity));
	} else children.push(solidFillSpPr(color, series.fillOpacity));
	if (series.invertIfNegative === true && SHAPES_WITH_INVERT.has(shape)) children.push(valNode(c("invertIfNegative"), "1"));
	if (SHAPES_WITH_MARKER.has(shape)) {
		const markerColor = series.markerColor !== void 0 ? hexOf(series.markerColor) : color;
		const markerLineColor = series.markerLineColor !== void 0 ? hexOf(series.markerLineColor) : markerColor;
		const markersOff = spec.kind === "stock" || shape === "scatter" && !SCATTER_STYLES_WITH_MARKER.has(scatterStyle) || shape === "radar" && spec.radarStyle !== "marker";
		children.push(markerElement(series.markerSymbol ?? (markersOff ? "none" : void 0), series.markerSizePt, markerColor, markerLineColor));
	}
	for (const dPt of dPtElements(series.pointColors, series.pointExplosions, series.fillOpacity, spec.bubble3D === true)) children.push(dPt);
	if (series.pointDataLabels !== void 0 && series.dataLabels === void 0) throw new Error(`chart: series '${series.name}' sets pointDataLabels without dataLabels; add the series-level dataLabels the overrides fall back to`);
	const serDLbls = buildDLblsFromLabels(series.dataLabels, series.pointDataLabels);
	if (serDLbls !== null) children.push(serDLbls);
	if (series.trendline && SHAPES_WITH_TRENDLINE.has(shape) && spec.kind !== "stock") children.push(trendlineElement(series.trendline));
	if (series.errorBars !== void 0 || series.xErrorBars !== void 0) {
		if (!SHAPES_WITH_ERR_BARS.has(shape)) throw new Error(`chart: series '${series.name}' sets error bars, which a ${kind} series cannot carry (bar / column / line / area / scatter / bubble only)`);
		if (series.xErrorBars !== void 0 && !isXy) throw new Error(`chart: series '${series.name}' sets xErrorBars, which only scatter / bubble series have an x channel for`);
		if (series.xErrorBars !== void 0) children.push(errBarsElement(series.xErrorBars, "x"));
		if (series.errorBars !== void 0) children.push(errBarsElement(series.errorBars, isXy ? "y" : null));
	}
	children.push(...channels);
	if (shape === "line") children.push(valNode(c("smooth"), series.smooth === true ? "1" : "0"));
	else if (shape === "scatter") {
		const smooth = series.smooth ?? (scatterStyle === "smooth" || scatterStyle === "smoothMarker");
		children.push(valNode(c("smooth"), smooth ? "1" : "0"));
	}
	return elem(c("ser"), { children });
};
const CAT_AX_ID = 111111111;
const VAL_AX_ID = 222222222;
const SEC_CAT_AX_ID = 333333333;
const SEC_VAL_AX_ID = 444444444;
const PRIMARY_AXES = {
	cat: CAT_AX_ID,
	val: VAL_AX_ID
};
const SECONDARY_AXES = {
	cat: SEC_CAT_AX_ID,
	val: SEC_VAL_AX_ID
};
/** Category kinds that can participate in a combo plot-group split. */
const COMBO_KINDS = new Set([
	"bar",
	"column",
	"line",
	"area"
]);
const effectiveSeriesKind = (spec, seriesIdx) => spec.series[seriesIdx]?.chartKind ?? spec.kind;
/**
* Splits the series into plot groups keyed by (effective kind, axis).
* Primary-axis groups come first so secondary overlays paint on top,
* and bar groups precede line/area within each axis for the same reason
* (matching PowerPoint's combo emit order).
*/
const comboPlotGroups = (spec) => {
	const groups = /* @__PURE__ */ new Map();
	for (let i = 0; i < spec.series.length; i++) {
		const kind = effectiveSeriesKind(spec, i);
		const secondary = spec.series[i]?.secondaryAxis === true;
		const key = `${kind}|${secondary ? "1" : "0"}`;
		const group = groups.get(key);
		if (group) group.indices.push(i);
		else groups.set(key, {
			kind,
			secondary,
			indices: [i]
		});
	}
	const paintOrder = (g) => (g.secondary ? 2 : 0) + (g.kind === "line" || g.kind === "area" ? 1 : 0);
	return [...groups.values()].sort((a, b) => paintOrder(a) - paintOrder(b));
};
const axisTxPrElement = (style, rotationDeg) => {
	if (style === void 0 && rotationDeg === void 0) return null;
	const bodyAttrs = [];
	if (rotationDeg !== void 0) bodyAttrs.push(attr(qname("", "rot", ""), String(Math.round(rotationDeg * 6e4))));
	bodyAttrs.push(attr(qname("", "vert", ""), "horz"));
	const bodyPr = elem(a("bodyPr"), { attrs: bodyAttrs });
	const { attrs: defAttrs, children: defChildren } = rPrAttrsFromStyle(style);
	const defRPr = elem(a("defRPr"), {
		attrs: defAttrs,
		children: defChildren
	});
	const pPr = elem(a("pPr"), { children: [defRPr] });
	return elem(c("txPr"), { children: [
		bodyPr,
		elem(a("lstStyle")),
		elem(a("p"), { children: [pPr] })
	] });
};
const catAxis = (spec) => {
	const catOrientation = spec.categoryAxisOrientation ?? "minMax";
	const dateAxis = spec.categoryAxisDate;
	const scalingChildren = [valNode(c("orientation"), catOrientation)];
	if (spec.categoryAxisScaling?.max !== void 0) scalingChildren.push(valNode(c("max"), spec.categoryAxisScaling.max));
	if (spec.categoryAxisScaling?.min !== void 0) scalingChildren.push(valNode(c("min"), spec.categoryAxisScaling.min));
	const children = [
		valNode(c("axId"), CAT_AX_ID),
		elem(c("scaling"), { children: scalingChildren }),
		valNode(c("delete"), spec.categoryAxisHidden ? "1" : "0"),
		valNode(c("axPos"), isHorizontalBar(spec) ? "l" : "b")
	];
	if (spec.categoryAxisMajorGridlines) children.push(gridlinesElement("majorGridlines", spec.categoryAxisMajorGridlineColor, spec.categoryAxisMajorGridlineWidthEmu, "chart: categoryAxisMajorGridlineWidthEmu"));
	if (spec.categoryAxisMinorGridlines) children.push(gridlinesElement("minorGridlines", spec.categoryAxisMinorGridlineColor, spec.categoryAxisMinorGridlineWidthEmu, "chart: categoryAxisMinorGridlineWidthEmu"));
	if (spec.categoryAxisTitle !== void 0) children.push(titleElement(spec.categoryAxisTitle, spec.categoryAxisTitleStyle, spec.categoryAxisTitleRotationDeg));
	if (spec.categoryAxisNumberFormat !== void 0) children.push(elem(c("numFmt"), { attrs: [attr(qname("", "formatCode", ""), spec.categoryAxisNumberFormat), attr(qname("", "sourceLinked", ""), "0")] }));
	if (spec.categoryAxisMajorTickMark !== void 0) children.push(valNode(c("majorTickMark"), spec.categoryAxisMajorTickMark));
	if (spec.categoryAxisMinorTickMark !== void 0) children.push(valNode(c("minorTickMark"), spec.categoryAxisMinorTickMark));
	if (spec.categoryAxisTickLabelPos !== void 0) children.push(valNode(c("tickLblPos"), spec.categoryAxisTickLabelPos));
	const catLine = lineSpPr(spec.categoryAxisLineColor, spec.categoryAxisLineWidthEmu, "chart: categoryAxisLineWidthEmu", spec.categoryAxisLineHidden === true);
	if (catLine !== null) children.push(catLine);
	const catTxPr = axisTxPrElement(spec.categoryAxisLabelStyle, spec.categoryAxisLabelRotationDeg);
	if (catTxPr) children.push(catTxPr);
	children.push(valNode(c("crossAx"), VAL_AX_ID));
	if (dateAxis !== void 0) {
		children.push(valNode(c("auto"), "0"));
		if (spec.categoryAxisLabelOffset !== void 0) children.push(valNode(c("lblOffset"), spec.categoryAxisLabelOffset));
		if (dateAxis.baseTimeUnit !== void 0) children.push(valNode(c("baseTimeUnit"), dateAxis.baseTimeUnit));
		if (dateAxis.majorUnit !== void 0) children.push(valNode(c("majorUnit"), dateAxis.majorUnit));
		if (dateAxis.majorTimeUnit !== void 0) children.push(valNode(c("majorTimeUnit"), dateAxis.majorTimeUnit));
		if (dateAxis.minorUnit !== void 0) children.push(valNode(c("minorUnit"), dateAxis.minorUnit));
		if (dateAxis.minorTimeUnit !== void 0) children.push(valNode(c("minorTimeUnit"), dateAxis.minorTimeUnit));
		return elem(c("dateAx"), { children });
	}
	if (spec.categoryAxisLabelAlign !== void 0) children.push(valNode(c("lblAlgn"), spec.categoryAxisLabelAlign));
	if (spec.categoryAxisLabelOffset !== void 0) children.push(valNode(c("lblOffset"), spec.categoryAxisLabelOffset));
	if (spec.categoryAxisTickLabelSkip !== void 0) children.push(valNode(c("tickLblSkip"), spec.categoryAxisTickLabelSkip));
	if (spec.categoryAxisTickMarkSkip !== void 0) children.push(valNode(c("tickMarkSkip"), spec.categoryAxisTickMarkSkip));
	if (spec.categoryAxisNoMultiLevelLabel) children.push(valNode(c("noMultiLvlLbl"), "1"));
	return elem(c("catAx"), { children });
};
const valueAxisElement = (f, ids) => {
	const scalingChildren = [];
	if (f.scaling?.logBase !== void 0) scalingChildren.push(valNode(c("logBase"), f.scaling.logBase));
	scalingChildren.push(valNode(c("orientation"), f.orientation ?? "minMax"));
	if (f.scaling?.max !== void 0) scalingChildren.push(valNode(c("max"), f.scaling.max));
	if (f.scaling?.min !== void 0) scalingChildren.push(valNode(c("min"), f.scaling.min));
	const children = [
		valNode(c("axId"), ids.axId),
		elem(c("scaling"), { children: scalingChildren }),
		valNode(c("delete"), f.hidden ? "1" : "0"),
		valNode(c("axPos"), ids.axPos)
	];
	if (f.majorGridlines) children.push(gridlinesElement("majorGridlines", f.majorGridlineColor, f.majorGridlineWidthEmu, `chart: ${f.widthFields.majorGridline}`));
	if (f.minorGridlines) children.push(gridlinesElement("minorGridlines", f.minorGridlineColor, f.minorGridlineWidthEmu, `chart: ${f.widthFields.minorGridline}`));
	if (f.title !== void 0) children.push(titleElement(f.title, f.titleStyle, f.titleRotationDeg));
	if (f.scaling?.numberFormat !== void 0) children.push(elem(c("numFmt"), { attrs: [attr(qname("", "formatCode", ""), f.scaling.numberFormat), attr(qname("", "sourceLinked", ""), "0")] }));
	if (f.majorTickMark !== void 0) children.push(valNode(c("majorTickMark"), f.majorTickMark));
	if (f.minorTickMark !== void 0) children.push(valNode(c("minorTickMark"), f.minorTickMark));
	if (f.tickLabelPos !== void 0) children.push(valNode(c("tickLblPos"), f.tickLabelPos));
	const axisLine = lineSpPr(f.lineColor, f.lineWidthEmu, `chart: ${f.widthFields.line}`, f.lineHidden === true);
	if (axisLine !== null) children.push(axisLine);
	const valTxPr = axisTxPrElement(f.labelStyle, f.labelRotationDeg);
	if (valTxPr) children.push(valTxPr);
	children.push(valNode(c("crossAx"), ids.crossAxId));
	const xross = f.crosses;
	if (xross !== void 0) if (typeof xross === "string") children.push(valNode(c("crosses"), xross));
	else children.push(valNode(c("crossesAt"), String(xross.at)));
	if (f.crossBetween !== void 0) children.push(valNode(c("crossBetween"), f.crossBetween));
	if (f.scaling?.majorUnit !== void 0) children.push(valNode(c("majorUnit"), f.scaling.majorUnit));
	if (f.scaling?.minorUnit !== void 0) children.push(valNode(c("minorUnit"), f.scaling.minorUnit));
	if (f.scaling?.displayUnits !== void 0) children.push(elem(c("dispUnits"), { children: [valNode(c("builtInUnit"), f.scaling.displayUnits), ...f.scaling.displayUnitsLabel === true ? [elem(c("dispUnitsLbl"))] : []] }));
	return elem(c("valAx"), { children });
};
const isHorizontalBar = (spec) => spec.kind === "bar";
const valAxis = (spec) => valueAxisElement({
	scaling: spec.valueAxis,
	orientation: spec.valueAxisOrientation,
	hidden: spec.valueAxisHidden,
	majorGridlines: spec.valueAxisMajorGridlines,
	majorGridlineColor: spec.valueAxisMajorGridlineColor,
	majorGridlineWidthEmu: spec.valueAxisMajorGridlineWidthEmu,
	minorGridlines: spec.valueAxisMinorGridlines,
	minorGridlineColor: spec.valueAxisMinorGridlineColor,
	minorGridlineWidthEmu: spec.valueAxisMinorGridlineWidthEmu,
	title: spec.valueAxisTitle,
	titleStyle: spec.valueAxisTitleStyle,
	titleRotationDeg: spec.valueAxisTitleRotationDeg,
	majorTickMark: spec.valueAxisMajorTickMark,
	minorTickMark: spec.valueAxisMinorTickMark,
	tickLabelPos: spec.valueAxisTickLabelPos,
	lineColor: spec.valueAxisLineColor,
	lineWidthEmu: spec.valueAxisLineWidthEmu,
	lineHidden: spec.valueAxisLineHidden,
	widthFields: {
		majorGridline: "valueAxisMajorGridlineWidthEmu",
		minorGridline: "valueAxisMinorGridlineWidthEmu",
		line: "valueAxisLineWidthEmu"
	},
	labelStyle: spec.valueAxisLabelStyle,
	labelRotationDeg: spec.valueAxisLabelRotationDeg,
	crosses: spec.valueAxisCrosses,
	crossBetween: spec.valueAxisCrossBetween
}, {
	axId: VAL_AX_ID,
	crossAxId: CAT_AX_ID,
	axPos: isHorizontalBar(spec) ? "b" : "l"
});
/**
* The horizontal axis of a scatter / bubble chart. Both of their axes are
* `<c:valAx>`; this one takes the spec's `categoryAxis*` fields, so an
* author formats "the axis along the bottom" the same way for every kind.
* It keeps the category axis' id, which the y axis already crosses.
*/
const xValAxis = (spec) => valueAxisElement({
	scaling: {
		...spec.categoryAxisScaling,
		...spec.categoryAxisNumberFormat !== void 0 ? { numberFormat: spec.categoryAxisNumberFormat } : {}
	},
	orientation: spec.categoryAxisOrientation,
	hidden: spec.categoryAxisHidden,
	majorGridlines: spec.categoryAxisMajorGridlines,
	majorGridlineColor: spec.categoryAxisMajorGridlineColor,
	majorGridlineWidthEmu: spec.categoryAxisMajorGridlineWidthEmu,
	minorGridlines: spec.categoryAxisMinorGridlines,
	minorGridlineColor: spec.categoryAxisMinorGridlineColor,
	minorGridlineWidthEmu: spec.categoryAxisMinorGridlineWidthEmu,
	title: spec.categoryAxisTitle,
	titleStyle: spec.categoryAxisTitleStyle,
	titleRotationDeg: spec.categoryAxisTitleRotationDeg,
	majorTickMark: spec.categoryAxisMajorTickMark,
	minorTickMark: spec.categoryAxisMinorTickMark,
	tickLabelPos: spec.categoryAxisTickLabelPos,
	lineColor: spec.categoryAxisLineColor,
	lineWidthEmu: spec.categoryAxisLineWidthEmu,
	lineHidden: spec.categoryAxisLineHidden,
	widthFields: {
		majorGridline: "categoryAxisMajorGridlineWidthEmu",
		minorGridline: "categoryAxisMinorGridlineWidthEmu",
		line: "categoryAxisLineWidthEmu"
	},
	labelStyle: spec.categoryAxisLabelStyle,
	labelRotationDeg: spec.categoryAxisLabelRotationDeg,
	crosses: void 0,
	crossBetween: "midCat"
}, {
	axId: CAT_AX_ID,
	crossAxId: VAL_AX_ID,
	axPos: "b"
});
const SER_AX_ID = 555555555;
/** `<c:serAx>` — the depth axis of a 3-D or surface chart; it crosses the value axis. */
const serAxis = (spec) => {
	const s = spec.seriesAxis ?? {};
	const children = [
		valNode(c("axId"), SER_AX_ID),
		elem(c("scaling"), { children: [valNode(c("orientation"), s.orientation ?? "minMax")] }),
		valNode(c("delete"), s.hidden ? "1" : "0"),
		valNode(c("axPos"), "b")
	];
	if (s.majorGridlines) children.push(elem(c("majorGridlines")));
	if (s.title !== void 0) children.push(titleElement(s.title, s.titleStyle));
	if (s.tickLabelPos !== void 0) children.push(valNode(c("tickLblPos"), s.tickLabelPos));
	const line = lineSpPr(s.lineColor, void 0, "chart: seriesAxis");
	if (line !== null) children.push(line);
	const txPr = axisTxPrElement(s.labelStyle, void 0);
	if (txPr !== null) children.push(txPr);
	children.push(valNode(c("crossAx"), VAL_AX_ID));
	if (s.tickLabelSkip !== void 0) children.push(valNode(c("tickLblSkip"), s.tickLabelSkip));
	return elem(c("serAx"), { children });
};
const buildDLblsFromLabels = (dl, pointLabels = void 0) => {
	const children = [];
	pointLabels?.forEach((pl, i) => {
		if (pl === null) return;
		children.push(elem(c("dLbl"), { children: [
			valNode(c("idx"), i),
			...pl.text !== void 0 ? [elem(c("tx"), { children: [richText(pl.text)] })] : [],
			...dLblGroupChildren(pl)
		] }));
	});
	if (dl) {
		children.push(...dLblGroupChildren(dl));
		if (dl.showLeaderLines !== void 0) children.push(valNode(c("showLeaderLines"), dl.showLeaderLines ? "1" : "0"));
	}
	return children.length === 0 ? null : elem(c("dLbls"), { children });
};
const dLblGroupChildren = (dl) => {
	const children = [];
	if (dl.numberFormat !== void 0) children.push(elem(c("numFmt"), { attrs: [attr(qname("", "formatCode", ""), dl.numberFormat), attr(qname("", "sourceLinked", ""), "0")] }));
	if (dl.fillColor !== void 0) children.push(solidFillSpPr(dl.fillColor));
	if (dl.textStyle !== void 0) {
		const txPr = axisTxPrElement(dl.textStyle, void 0);
		if (txPr !== null) children.push(txPr);
	}
	if (dl.position !== void 0) children.push(valNode(c("dLblPos"), dl.position));
	children.push(valNode(c("showLegendKey"), dl.showLegendKey ? "1" : "0"), valNode(c("showVal"), dl.showValue ? "1" : "0"), valNode(c("showCatName"), dl.showCategory ? "1" : "0"), valNode(c("showSerName"), dl.showSeriesName ? "1" : "0"), valNode(c("showPercent"), dl.showPercent ? "1" : "0"), valNode(c("showBubbleSize"), dl.showBubbleSize ? "1" : "0"));
	if (dl.separator !== void 0) children.push(elem(c("separator"), { children: [text(dl.separator)] }));
	return children;
};
const dLblsElement = (spec) => buildDLblsFromLabels(spec.dataLabels);
const groupSeries = (g) => g.seriesIndices.map((i) => seriesElement(g.spec, i, g.layout));
const groupDLbls = (g) => {
	const dl = dLblsElement(g.spec);
	return dl ? [dl] : [];
};
const isThreeD = (spec) => spec.view3D !== void 0;
/**
* Whether the chart carries a series (depth) axis. `<c:line3DChart>` and
* the surface elements require three axes; 3-D bar / area charts only lay
* their series out in depth — and so only have the axis — under the
* `standard` grouping.
*/
const hasSeriesAxis = (spec) => {
	if (spec.kind === "surface") return true;
	if (!isThreeD(spec)) return false;
	if (spec.kind === "line") return true;
	return (spec.kind === "bar" || spec.kind === "column" || spec.kind === "area") && spec.grouping === "standard";
};
const axIdNodes = (g) => [
	valNode(c("axId"), g.axes.cat),
	valNode(c("axId"), g.axes.val),
	...hasSeriesAxis(g.spec) ? [valNode(c("axId"), SER_AX_ID)] : []
];
const gapDepthNodes = (spec) => spec.gapDepthPct !== void 0 ? [valNode(c("gapDepth"), gapAmountPercent(spec.gapDepthPct, "chart: gapDepthPct"))] : [];
const buildBarChart = (g, direction) => {
	const { spec } = g;
	const grouping = spec.grouping ?? "clustered";
	const children = [
		valNode(c("barDir"), direction),
		valNode(c("grouping"), grouping),
		valNode(c("varyColors"), spec.varyColors ? "1" : "0"),
		...groupSeries(g),
		...groupDLbls(g)
	];
	if (spec.gapWidthPct !== void 0) children.push(valNode(c("gapWidth"), gapAmountPercent(spec.gapWidthPct, "chart: gapWidthPct")));
	if (isThreeD(spec)) {
		children.push(...gapDepthNodes(spec));
		if (spec.bar3DShape !== void 0) children.push(valNode(c("shape"), spec.bar3DShape));
		children.push(...axIdNodes(g));
		return elem(c("bar3DChart"), { children });
	}
	const overlapPct = spec.overlapPct ?? (grouping === "stacked" || grouping === "percentStacked" ? 100 : void 0);
	if (overlapPct !== void 0) children.push(valNode(c("overlap"), overlapPercent(overlapPct, "chart: overlapPct")));
	children.push(...axIdNodes(g));
	return elem(c("barChart"), { children });
};
const lineAreaGrouping = (spec) => spec.grouping === "stacked" || spec.grouping === "percentStacked" ? spec.grouping : "standard";
const upDownBarsElement = (bars) => {
	const bar = (name, color) => elem(c(name), { children: color !== void 0 ? [solidFillSpPr(color)] : [] });
	return elem(c("upDownBars"), { children: [
		...bars.gapWidthPct !== void 0 ? [valNode(c("gapWidth"), gapAmountPercent(bars.gapWidthPct, "chart: upDownBars.gapWidthPct"))] : [],
		bar("upBars", bars.upColor),
		bar("downBars", bars.downColor)
	] });
};
const buildLineChart = (g) => {
	const { spec } = g;
	const children = [
		valNode(c("grouping"), lineAreaGrouping(spec)),
		valNode(c("varyColors"), spec.varyColors ? "1" : "0"),
		...groupSeries(g),
		...groupDLbls(g)
	];
	if (spec.dropLines) children.push(elem(c("dropLines")));
	if (isThreeD(spec)) {
		if (spec.hiLowLines || spec.upDownBars !== void 0) throw new Error("chart: hiLowLines / upDownBars are not available on a 3-D line chart");
		children.push(...gapDepthNodes(spec), ...axIdNodes(g));
		return elem(c("line3DChart"), { children });
	}
	if (spec.hiLowLines) children.push(elem(c("hiLowLines")));
	if (spec.upDownBars !== void 0) children.push(upDownBarsElement(spec.upDownBars));
	children.push(valNode(c("marker"), spec.lineMarkers === false ? "0" : "1"), ...axIdNodes(g));
	return elem(c("lineChart"), { children });
};
const buildAreaChart = (g) => {
	const { spec } = g;
	const children = [
		valNode(c("grouping"), lineAreaGrouping(spec)),
		valNode(c("varyColors"), spec.varyColors ? "1" : "0"),
		...groupSeries(g),
		...groupDLbls(g)
	];
	if (spec.dropLines && spec.kind === "area") children.push(elem(c("dropLines")));
	if (isThreeD(spec)) {
		children.push(...gapDepthNodes(spec), ...axIdNodes(g));
		return elem(c("area3DChart"), { children });
	}
	children.push(...axIdNodes(g));
	return elem(c("areaChart"), { children });
};
const requireSingleSeries = (spec) => {
	if (spec.series.length !== 1) throw new Error(`${spec.kind} chart requires exactly one series`);
};
const firstSliceAngNodes = (spec) => spec.firstSliceAngleDeg !== void 0 ? [valNode(c("firstSliceAng"), firstSliceAngle(spec.firstSliceAngleDeg, "chart: firstSliceAngleDeg"))] : [];
const buildOfPieChart = (g, ofPie) => {
	const children = [
		valNode(c("ofPieType"), ofPie.type),
		valNode(c("varyColors"), "1"),
		...groupSeries(g),
		...groupDLbls(g)
	];
	if (ofPie.gapWidthPct !== void 0) children.push(valNode(c("gapWidth"), gapAmountPercent(ofPie.gapWidthPct, "chart: ofPie.gapWidthPct")));
	if (ofPie.customSplit !== void 0 && ofPie.splitType !== "cust") throw new Error("chart: ofPie.customSplit requires ofPie.splitType 'cust'");
	if (ofPie.splitType !== void 0) children.push(valNode(c("splitType"), ofPie.splitType));
	if (ofPie.splitPos !== void 0) children.push(valNode(c("splitPos"), ofPie.splitPos));
	if (ofPie.customSplit !== void 0) children.push(elem(c("custSplit"), { children: ofPie.customSplit.map((idx) => valNode(c("secondPiePt"), idx)) }));
	if (ofPie.secondPieSizePct !== void 0) children.push(valNode(c("secondPieSize"), boundedInt(ofPie.secondPieSizePct, "secondPieSize", "chart: ofPie.secondPieSizePct")));
	if (ofPie.seriesLines) children.push(elem(c("serLines")));
	return elem(c("ofPieChart"), { children });
};
const buildPieChart = (g) => {
	const { spec } = g;
	requireSingleSeries(spec);
	if (spec.ofPie !== void 0) {
		if (isThreeD(spec)) throw new Error("chart: ofPie and view3D cannot be combined");
		return buildOfPieChart(g, spec.ofPie);
	}
	const children = [
		valNode(c("varyColors"), "1"),
		...groupSeries(g),
		...groupDLbls(g)
	];
	if (isThreeD(spec)) {
		if (spec.firstSliceAngleDeg !== void 0) throw new Error("chart: a 3-D pie has no firstSliceAngleDeg; rotate it with view3D.rotY");
		return elem(c("pie3DChart"), { children });
	}
	children.push(...firstSliceAngNodes(spec));
	return elem(c("pieChart"), { children });
};
const buildDoughnutChart = (g) => {
	const { spec } = g;
	requireSingleSeries(spec);
	return elem(c("doughnutChart"), { children: [
		valNode(c("varyColors"), "1"),
		...groupSeries(g),
		...groupDLbls(g),
		...firstSliceAngNodes(spec),
		valNode(c("holeSize"), holeSizePercent(spec.holeSizePct ?? 50, "chart: holeSizePct"))
	] });
};
const buildScatterChart = (g) => elem(c("scatterChart"), { children: [
	valNode(c("scatterStyle"), g.spec.scatterStyle ?? "marker"),
	valNode(c("varyColors"), g.spec.varyColors ? "1" : "0"),
	...groupSeries(g),
	...groupDLbls(g),
	...axIdNodes(g)
] });
const buildBubbleChart = (g) => {
	const { spec } = g;
	const children = [
		valNode(c("varyColors"), spec.varyColors ? "1" : "0"),
		...groupSeries(g),
		...groupDLbls(g)
	];
	if (spec.bubbleScale !== void 0) children.push(valNode(c("bubbleScale"), boundedInt(spec.bubbleScale, "bubbleScale", "chart: bubbleScale")));
	if (spec.showNegativeBubbles !== void 0) children.push(valNode(c("showNegBubbles"), spec.showNegativeBubbles ? "1" : "0"));
	if (spec.bubbleSizeRepresents !== void 0) children.push(valNode(c("sizeRepresents"), spec.bubbleSizeRepresents === "width" ? "w" : "area"));
	children.push(...axIdNodes(g));
	return elem(c("bubbleChart"), { children });
};
const buildRadarChart = (g) => elem(c("radarChart"), { children: [
	valNode(c("radarStyle"), g.spec.radarStyle ?? "standard"),
	valNode(c("varyColors"), g.spec.varyColors ? "1" : "0"),
	...groupSeries(g),
	...groupDLbls(g),
	...axIdNodes(g)
] });
const buildStockChart = (g) => {
	const { spec } = g;
	const count = spec.series.length;
	if (count !== 3 && count !== 4) throw new Error(`stock chart requires 3 series (high, low, close) or 4 (open, high, low, close); got ${count}`);
	const children = [...groupSeries(g), ...groupDLbls(g)];
	if (spec.dropLines) children.push(elem(c("dropLines")));
	if (spec.hiLowLines !== false) children.push(elem(c("hiLowLines")));
	if (spec.upDownBars !== void 0 && count !== 4) throw new Error("stock chart: upDownBars require the 4-series form (open, high, low, close)");
	if (count === 4) children.push(upDownBarsElement(spec.upDownBars ?? {}));
	children.push(...axIdNodes(g));
	return elem(c("stockChart"), { children });
};
const buildSurfaceChart = (g) => {
	const { spec } = g;
	const children = [];
	if (spec.surfaceWireframe !== void 0) children.push(valNode(c("wireframe"), spec.surfaceWireframe ? "1" : "0"));
	children.push(...groupSeries(g), ...axIdNodes(g));
	return elem(c(spec.surfaceContour === true ? "surfaceChart" : "surface3DChart"), { children });
};
/** One plot group, dispatched by its effective kind. */
const buildPlotGroup = (g, kind) => {
	switch (kind) {
		case "column": return buildBarChart(g, "col");
		case "bar": return buildBarChart(g, "bar");
		case "line": return buildLineChart(g);
		case "area": return buildAreaChart(g);
		case "pie": return buildPieChart(g);
		case "doughnut": return buildDoughnutChart(g);
		case "scatter": return buildScatterChart(g);
		case "bubble": return buildBubbleChart(g);
		case "radar": return buildRadarChart(g);
		case "stock": return buildStockChart(g);
		case "surface": return buildSurfaceChart(g);
		default: throw new Error(`unsupported chart kind: ${String(kind)}`);
	}
};
/**
* Secondary value axis (`axPos="r"`, crossing at the category maximum) —
* the right-hand axis PowerPoint pairs with `secondaryAxis` series.
* Formatting comes from `spec.secondaryValueAxis`; PowerPoint's defaults
* apply for everything left out.
*/
const secondaryValAxis = (spec) => {
	const s = spec.secondaryValueAxis ?? {};
	return valueAxisElement({
		scaling: s.scaling,
		orientation: void 0,
		hidden: void 0,
		majorGridlines: s.majorGridlines,
		majorGridlineColor: s.majorGridlineColor,
		majorGridlineWidthEmu: s.majorGridlineWidthEmu,
		minorGridlines: void 0,
		minorGridlineColor: void 0,
		minorGridlineWidthEmu: void 0,
		title: s.title,
		titleStyle: s.titleStyle,
		titleRotationDeg: void 0,
		majorTickMark: s.majorTickMark,
		minorTickMark: s.minorTickMark,
		tickLabelPos: s.tickLabelPos,
		lineColor: s.lineColor,
		lineWidthEmu: s.lineWidthEmu,
		lineHidden: void 0,
		widthFields: {
			majorGridline: "secondaryValueAxis.majorGridlineWidthEmu",
			minorGridline: "secondaryValueAxis.minorGridlineWidthEmu",
			line: "secondaryValueAxis.lineWidthEmu"
		},
		labelStyle: s.labelStyle,
		labelRotationDeg: void 0,
		crosses: "max",
		crossBetween: s.crossBetween
	}, {
		axId: SEC_VAL_AX_ID,
		crossAxId: SEC_CAT_AX_ID,
		axPos: "r"
	});
};
/**
* Deleted companion category axis for the secondary pair. PowerPoint
* requires every plot group's axId pair to resolve to a cat+val pair,
* so the secondary group gets its own (hidden) category axis.
*/
const secondaryCatAxis = (spec) => elem(c("catAx"), { children: [
	valNode(c("axId"), SEC_CAT_AX_ID),
	elem(c("scaling"), { children: [valNode(c("orientation"), "minMax")] }),
	valNode(c("delete"), "1"),
	valNode(c("axPos"), isHorizontalBar(spec) ? "l" : "b"),
	valNode(c("crossAx"), SEC_VAL_AX_ID)
] });
const rPrAttrsFromStyle = (style) => {
	const attrs = [];
	const children = [];
	if (style?.sizePt !== void 0) attrs.push(attr(qname("", "sz", ""), String(Math.round(style.sizePt * 100))));
	if (style?.bold === true) attrs.push(attr(qname("", "b", ""), "1"));
	if (style?.bold === false) attrs.push(attr(qname("", "b", ""), "0"));
	if (style?.italic === true) attrs.push(attr(qname("", "i", ""), "1"));
	if (style?.italic === false) attrs.push(attr(qname("", "i", ""), "0"));
	if (style?.color !== void 0) {
		const hex = style.color.startsWith("#") ? style.color.slice(1) : style.color;
		children.push(elem(a("solidFill"), { children: [elem(a("srgbClr"), { attrs: [attr(qname("", "val", ""), hex.toUpperCase())] })] }));
	}
	if (style?.font !== void 0) {
		const typeface = attr(qname("", "typeface", ""), style.font);
		children.push(elem(a("latin"), { attrs: [typeface] }));
		children.push(elem(a("ea"), { attrs: [typeface] }));
	}
	if (style?.fontComplexScript !== void 0) children.push(elem(a("cs"), { attrs: [attr(qname("", "typeface", ""), style.fontComplexScript)] }));
	return {
		attrs,
		children
	};
};
const manualLayoutElement = (position, size, target) => elem(c("layout"), { children: [elem(c("manualLayout"), { children: [
	...target !== void 0 ? [valNode(c("layoutTarget"), target)] : [],
	valNode(c("xMode"), "edge"),
	valNode(c("yMode"), "edge"),
	valNode(c("x"), position.x),
	valNode(c("y"), position.y),
	...size !== void 0 ? [valNode(c("w"), size.w), valNode(c("h"), size.h)] : []
] })] });
const richText = (value) => elem(c("rich"), { children: [
	elem(a("bodyPr")),
	elem(a("lstStyle")),
	elem(a("p"), { children: [elem(a("r"), { children: [elem(a("t"), { children: [text(value)] })] })] })
] });
const titleElement = (title, style, rotationDeg, placement) => {
	const pPr = elem(a("pPr"), { children: [elem(a("defRPr"))] });
	const { attrs: runAttrs, children: runChildren } = rPrAttrsFromStyle(style);
	const runRPr = elem(a("rPr"), {
		attrs: runAttrs,
		children: runChildren
	});
	const tRun = elem(a("r"), { children: [runRPr, elem(a("t"), { children: [text(title)] })] });
	const para = elem(a("p"), { children: [pPr, tRun] });
	const rich = elem(c("rich"), { children: [
		elem(a("bodyPr"), { attrs: [
			...rotationDeg !== void 0 ? [attr(qname("", "rot", ""), String(Math.round(rotationDeg * 6e4)))] : [],
			attr(qname("", "spcFirstLastPara", ""), "1"),
			attr(qname("", "vertOverflow", ""), "ellipsis"),
			...rotationDeg !== void 0 ? [attr(qname("", "vert", ""), "horz")] : [],
			attr(qname("", "wrap", ""), "square"),
			attr(qname("", "anchor", ""), "ctr"),
			attr(qname("", "anchorCtr", ""), "1")
		] }),
		elem(a("lstStyle")),
		para
	] });
	return elem(c("title"), { children: [
		elem(c("tx"), { children: [rich] }),
		...placement?.layout !== void 0 ? [manualLayoutElement(placement.layout)] : [],
		valNode(c("overlay"), placement?.overlay === true ? "1" : "0")
	] });
};
const view3DDefaults = (spec) => {
	if (spec.kind === "surface" && spec.surfaceContour === true) return {
		rotX: 90,
		rotY: 0,
		rightAngleAxes: false,
		perspective: 0
	};
	if (spec.kind === "pie") return {
		rotX: 30,
		rotY: 0,
		rightAngleAxes: false
	};
	if (spec.kind === "surface") return {
		rotX: 15,
		rotY: 20,
		rightAngleAxes: false,
		perspective: 30
	};
	return {
		rotX: 15,
		rotY: 20,
		rightAngleAxes: true
	};
};
const view3DElement = (spec) => {
	const v = {
		...view3DDefaults(spec),
		...spec.view3D
	};
	const children = [];
	if (v.rotX !== void 0) children.push(valNode(c("rotX"), boundedInt(v.rotX, "rotX", "chart: view3D.rotX")));
	if (v.heightPercent !== void 0) children.push(valNode(c("hPercent"), boundedInt(v.heightPercent, "heightPercent", "chart: view3D.heightPercent")));
	if (v.rotY !== void 0) children.push(valNode(c("rotY"), boundedInt(v.rotY, "rotY", "chart: view3D.rotY")));
	if (v.depthPercent !== void 0) children.push(valNode(c("depthPercent"), boundedInt(v.depthPercent, "depthPercent", "chart: view3D.depthPercent")));
	if (v.rightAngleAxes !== void 0) children.push(valNode(c("rAngAx"), v.rightAngleAxes ? "1" : "0"));
	if (v.perspective !== void 0) children.push(valNode(c("perspective"), boundedInt(v.perspective, "perspective", "chart: view3D.perspective")));
	return elem(c("view3D"), { children });
};
const KINDS_WITH_VIEW_3D = new Set([
	"bar",
	"column",
	"line",
	"area",
	"pie",
	"surface"
]);
const AXISLESS_KINDS = new Set(["pie", "doughnut"]);
const XY_KINDS = new Set(["scatter", "bubble"]);
const validateSpec = (spec, usesComboFields) => {
	if (usesComboFields && !COMBO_KINDS.has(spec.kind)) throw new Error(`chart kind '${spec.kind}' does not support per-series chartKind / secondaryAxis (combo charts require a bar / column / line / area base kind)`);
	if (spec.view3D !== void 0) {
		if (!KINDS_WITH_VIEW_3D.has(spec.kind)) throw new Error(`chart kind '${spec.kind}' has no 3-D variant; view3D applies to bar / column / line / area / pie / surface`);
		if (usesComboFields) throw new Error("chart: view3D cannot be combined with a combo chart");
	}
	if ((spec.bar3DShape !== void 0 || spec.gapDepthPct !== void 0) && spec.view3D === void 0) throw new Error("chart: bar3DShape / gapDepthPct require view3D");
	if (spec.ofPie !== void 0 && spec.kind !== "pie") throw new Error(`chart: ofPie applies to kind 'pie', not '${spec.kind}'`);
	if (spec.dataTable !== void 0 && (AXISLESS_KINDS.has(spec.kind) || XY_KINDS.has(spec.kind))) throw new Error(`chart kind '${spec.kind}' cannot show a data table`);
	if (spec.categoryAxisDate !== void 0) {
		if (AXISLESS_KINDS.has(spec.kind) || XY_KINDS.has(spec.kind)) throw new Error(`chart kind '${spec.kind}' has no category axis to make a date axis of`);
		if (spec.categoryGroupLevels !== void 0) throw new Error("chart: a date axis cannot have categoryGroupLevels");
		spec.categories.forEach((category, i) => {
			if (category.trim() === "" || !Number.isFinite(Number(category))) throw new Error(`chart: categories[${i}] is ${JSON.stringify(category)}; a date axis needs date serial numbers (e.g. "45292" for 2024-01-01)`);
		});
	}
	if (spec.categoryAxisScaling !== void 0 && spec.categoryAxisDate === void 0 && !XY_KINDS.has(spec.kind)) throw new Error("chart: categoryAxisScaling needs a numeric horizontal axis — a scatter / bubble chart or a date axis");
	spec.categoryGroupLevels?.forEach((level, i) => {
		if (level.length !== spec.categories.length) throw new Error(`chart: categoryGroupLevels[${i}] has ${level.length} entries for ${spec.categories.length} categories`);
	});
	if (XY_KINDS.has(spec.kind)) spec.series.forEach((series) => {
		if (series.xValues === void 0) throw new Error(`chart: ${spec.kind} series '${series.name}' needs xValues`);
		if (spec.kind === "bubble" && series.bubbleSizes === void 0) throw new Error(`chart: bubble series '${series.name}' needs bubbleSizes`);
	});
};
const dataTableElement = (table) => {
	const children = [
		valNode(c("showHorzBorder"), table.showHorizontalBorder === false ? "0" : "1"),
		valNode(c("showVertBorder"), table.showVerticalBorder === false ? "0" : "1"),
		valNode(c("showOutline"), table.showOutline === false ? "0" : "1"),
		valNode(c("showKeys"), table.showKeys === false ? "0" : "1")
	];
	const txPr = axisTxPrElement(table.textStyle, void 0);
	if (txPr !== null) children.push(txPr);
	return elem(c("dTable"), { children });
};
/**
* Builds a complete `<c:chartSpace>` document for `spec`. The caller
* wires the `<c:externalData>` rel; this builder always emits
* `r:id="rId1"` for the embedded workbook.
*/
const buildChartSpaceDoc = (spec) => {
	const usesComboFields = spec.series.some((series) => series.chartKind !== void 0 || series.secondaryAxis === true);
	validateSpec(spec, usesComboFields);
	const layout = layoutChartSheet(spec);
	let plottedGroups;
	let hasSecondary = false;
	if (usesComboFields) {
		const groups = comboPlotGroups(spec);
		hasSecondary = groups.some((group) => group.secondary);
		plottedGroups = groups.map((group) => buildPlotGroup({
			spec,
			layout,
			seriesIndices: group.indices,
			axes: group.secondary ? SECONDARY_AXES : PRIMARY_AXES
		}, group.kind));
	} else plottedGroups = [buildPlotGroup({
		spec,
		layout,
		seriesIndices: spec.series.map((_, i) => i),
		axes: PRIMARY_AXES
	}, spec.kind)];
	const plotLayout = spec.plotAreaLayout;
	const plotAreaChildren = [plotLayout !== void 0 ? manualLayoutElement(plotLayout, plotLayout, plotLayout.target) : elem(c("layout")), ...plottedGroups];
	if (!AXISLESS_KINDS.has(spec.kind)) {
		plotAreaChildren.push(XY_KINDS.has(spec.kind) ? xValAxis(spec) : catAxis(spec), valAxis(spec));
		if (hasSeriesAxis(spec)) plotAreaChildren.push(serAxis(spec));
		if (hasSecondary) plotAreaChildren.push(secondaryValAxis(spec), secondaryCatAxis(spec));
	}
	if (spec.dataTable !== void 0) plotAreaChildren.push(dataTableElement(spec.dataTable));
	if (spec.plotAreaFill !== void 0 || spec.plotAreaStrokeColor !== void 0) plotAreaChildren.push(spPrChildren(spec.plotAreaFill, spec.plotAreaStrokeColor));
	const plotArea = elem(c("plotArea"), { children: plotAreaChildren });
	const chartChildren = [];
	if (spec.title !== void 0) chartChildren.push(titleElement(spec.title, spec.titleStyle, void 0, {
		...spec.titleOverlay !== void 0 ? { overlay: spec.titleOverlay } : {},
		...spec.titleLayout !== void 0 ? { layout: spec.titleLayout } : {}
	}));
	chartChildren.push(valNode(c("autoTitleDeleted"), spec.title !== void 0 ? "0" : "1"));
	if (spec.view3D !== void 0 || spec.kind === "surface") chartChildren.push(view3DElement(spec));
	chartChildren.push(plotArea);
	if (spec.legend !== void 0 && spec.legend.position !== null) {
		const legendChildren = [valNode(c("legendPos"), spec.legend.position)];
		for (const idx of spec.legend.hiddenIndices ?? []) legendChildren.push(elem(c("legendEntry"), { children: [valNode(c("idx"), idx), valNode(c("delete"), "1")] }));
		if (spec.legend.layout !== void 0) legendChildren.push(manualLayoutElement(spec.legend.layout, spec.legend.layout));
		legendChildren.push(valNode(c("overlay"), spec.legend.overlay ? "1" : "0"));
		if (spec.legend.textStyle !== void 0) {
			const txPr = axisTxPrElement(spec.legend.textStyle, void 0);
			if (txPr !== null) legendChildren.push(txPr);
		}
		chartChildren.push(elem(c("legend"), { children: legendChildren }));
	}
	chartChildren.push(valNode(c("plotVisOnly"), spec.plotVisibleCellsOnly === false ? "0" : "1"), valNode(c("dispBlanksAs"), spec.dispBlanksAs ?? "gap"));
	const chart = elem(c("chart"), { children: chartChildren });
	const externalData = elem(c("externalData"), {
		attrs: [attr(r("id"), "rId1")],
		children: [valNode(c("autoUpdate"), "0")]
	});
	const rootChildren = [];
	if (spec.date1904) rootChildren.push(valNode(c("date1904"), "1"));
	if (spec.language !== void 0) rootChildren.push(valNode(c("lang"), spec.language));
	if (spec.roundedCorners) rootChildren.push(valNode(c("roundedCorners"), "1"));
	if (spec.chartStyle !== void 0) rootChildren.push(valNode(c("style"), Math.round(spec.chartStyle)));
	rootChildren.push(chart);
	if (spec.chartAreaFill !== void 0 || spec.chartAreaStrokeColor !== void 0) rootChildren.push(spPrChildren(spec.chartAreaFill, spec.chartAreaStrokeColor));
	rootChildren.push(externalData);
	return {
		kind: "document",
		decl: {
			version: "1.0",
			encoding: "UTF-8",
			standalone: "yes"
		},
		prolog: [],
		root: elem(c("chartSpace"), {
			prefixDecls: new Map([
				["c", NS_C$1],
				["a", NS_A$1],
				["r", NS_R]
			]),
			children: rootChildren
		}),
		epilog: []
	};
};
//#endregion
//#region src/internal/chartml/chart-reader.ts
const NS_C = NS.chart;
const NS_A = NS.dml;
const NAME_CHART = qname("c", "chart", NS_C);
const NAME_PLOT_AREA = qname("c", "plotArea", NS_C);
const NAME_SER = qname("c", "ser", NS_C);
const NAME_TX = qname("c", "tx", NS_C);
const NAME_CAT = qname("c", "cat", NS_C);
const NAME_VAL = qname("c", "val", NS_C);
const NAME_STR_REF = qname("c", "strRef", NS_C);
const NAME_NUM_REF = qname("c", "numRef", NS_C);
const NAME_STR_CACHE = qname("c", "strCache", NS_C);
const NAME_NUM_CACHE = qname("c", "numCache", NS_C);
const NAME_STR_LIT = qname("c", "strLit", NS_C);
const NAME_NUM_LIT = qname("c", "numLit", NS_C);
const NAME_MULTI_LVL_STR_REF = qname("c", "multiLvlStrRef", NS_C);
const NAME_MULTI_LVL_STR_CACHE = qname("c", "multiLvlStrCache", NS_C);
const NAME_LVL = qname("c", "lvl", NS_C);
const NAME_PT = qname("c", "pt", NS_C);
const NAME_PT_COUNT = qname("c", "ptCount", NS_C);
const MAX_PT_COUNT = 1048576;
const NAME_V = qname("c", "v", NS_C);
const NAME_D_LBLS = qname("c", "dLbls", NS_C);
const NAME_D_LBL = qname("c", "dLbl", NS_C);
const NAME_VAL_AX = qname("c", "valAx", NS_C);
const NAME_TITLE = qname("c", "title", NS_C);
const NAME_RICH = qname("c", "rich", NS_C);
const NAME_T = qname("a", "t", NS_A);
const NAME_P_DML = qname("a", "p", NS_A);
const NAME_R_DML = qname("a", "r", NS_A);
const NAME_SP_PR_C = qname("c", "spPr", NS_C);
const NAME_SOLID_FILL$1 = qname("a", "solidFill", NS_A);
const NAME_SRGB_CLR = qname("a", "srgbClr", NS_A);
const ATTR_VAL = qname("", "val", "");
const ATTR_IDX = qname("", "idx", "");
/** Kinds a combo plot group can carry (mirrors `ChartSeries.chartKind`). */
const isComboSeriesKind = (kind) => kind === "bar" || kind === "column" || kind === "line" || kind === "area";
const KIND_MAP = [
	{
		localName: "barChart",
		kind: "column"
	},
	{
		localName: "bar3DChart",
		kind: "column"
	},
	{
		localName: "lineChart",
		kind: "line"
	},
	{
		localName: "line3DChart",
		kind: "line"
	},
	{
		localName: "pieChart",
		kind: "pie"
	},
	{
		localName: "pie3DChart",
		kind: "pie"
	},
	{
		localName: "ofPieChart",
		kind: "pie"
	},
	{
		localName: "doughnutChart",
		kind: "doughnut"
	},
	{
		localName: "areaChart",
		kind: "area"
	},
	{
		localName: "area3DChart",
		kind: "area"
	},
	{
		localName: "scatterChart",
		kind: "scatter"
	},
	{
		localName: "bubbleChart",
		kind: "bubble"
	},
	{
		localName: "radarChart",
		kind: "radar"
	},
	{
		localName: "stockChart",
		kind: "stock"
	},
	{
		localName: "surfaceChart",
		kind: "surface"
	},
	{
		localName: "surface3DChart",
		kind: "surface"
	}
];
const findFirst = (parent, names) => {
	for (const c of parent.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS_C) continue;
		if (names.includes(c.name.localName)) return c;
	}
	return null;
};
const readPtCount = (host) => {
	const ptCountEl = firstChildElement(host, NAME_PT_COUNT);
	const raw = ptCountEl !== null ? getAttrValue(ptCountEl, ATTR_VAL) : null;
	return raw !== null ? Number.parseInt(raw, 10) : NaN;
};
const readXmlBool = (el) => {
	const v = getAttrValue(el, ATTR_VAL);
	return v === null || v === "1" || v === "true";
};
const parsePointIndex = (raw, limit) => {
	if (raw === null || !/^\d+$/.test(raw)) return null;
	const idx = Number.parseInt(raw, 10);
	return idx < limit ? idx : null;
};
const readPointIndex = (host, pointCount) => {
	const idxEl = firstChildElement(host, qname("c", "idx", NS_C));
	return parsePointIndex(idxEl !== null ? getAttrValue(idxEl, ATTR_VAL) : null, pointCount);
};
const readPtArray = (cache, countHost = cache) => {
	const out = [];
	const ptCount = readPtCount(countHost);
	const idxLimit = Number.isFinite(ptCount) ? Math.min(ptCount, MAX_PT_COUNT) : MAX_PT_COUNT;
	for (const pt of allChildElements(cache, NAME_PT)) {
		const idx = parsePointIndex(getAttrValue(pt, ATTR_IDX), idxLimit);
		if (idx === null) continue;
		const v = firstChildElement(pt, NAME_V);
		if (v === null) continue;
		let text = "";
		for (const child of v.children) if (child.kind === "text" || child.kind === "cdata") text += child.data;
		out[idx] = text;
	}
	if (Number.isFinite(ptCount) && ptCount <= MAX_PT_COUNT) {
		for (let i = 0; i < ptCount; i++) if (out[i] === void 0) out[i] = "";
	}
	return out;
};
const readStringChannel = (parent) => {
	const ref = firstChildElement(parent, NAME_STR_REF);
	if (ref) {
		const cache = firstChildElement(ref, NAME_STR_CACHE);
		if (cache) return readPtArray(cache);
	}
	const lit = firstChildElement(parent, NAME_STR_LIT);
	if (lit) return readPtArray(lit);
	const multi = firstChildElement(parent, NAME_MULTI_LVL_STR_REF);
	if (multi) {
		const cache = firstChildElement(multi, NAME_MULTI_LVL_STR_CACHE);
		const lvl = cache ? firstChildElement(cache, NAME_LVL) : null;
		if (lvl && cache) return readPtArray(lvl, cache);
	}
	return null;
};
const readStringRef = (parent) => readStringChannel(parent);
const readNumChannel = (parent) => {
	const ref = firstChildElement(parent, NAME_NUM_REF);
	let raw = null;
	if (ref) {
		const cache = firstChildElement(ref, NAME_NUM_CACHE);
		if (cache) raw = readPtArray(cache);
	}
	if (!raw) {
		const lit = firstChildElement(parent, NAME_NUM_LIT);
		if (lit) raw = readPtArray(lit);
	}
	if (!raw) return null;
	return raw.map((s) => {
		if (s === void 0 || s === "") return null;
		const n = Number.parseFloat(s);
		return Number.isFinite(n) ? n : null;
	});
};
const readNumRef = (parent) => readNumChannel(parent);
const readSeriesName = (ser) => {
	const tx = firstChildElement(ser, NAME_TX);
	if (!tx) return "";
	return readStringRef(tx)?.[0] ?? "";
};
const readDataPointOverrides = (ser, pointCount) => {
	const colors = [];
	const explosions = [];
	let anyColor = false;
	let anyExplosion = false;
	for (const c of ser.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS_C || c.name.localName !== "dPt") continue;
		const idx = readPointIndex(c, pointCount);
		if (idx === null) continue;
		const spPr = firstChildElement(c, NAME_SP_PR_C);
		if (spPr) {
			const solidFill = firstChildElement(spPr, NAME_SOLID_FILL$1);
			if (solidFill) {
				const srgb = firstChildElement(solidFill, NAME_SRGB_CLR);
				if (srgb) {
					const val = getAttrValue(srgb, ATTR_VAL);
					if (val !== null) {
						colors[idx] = `#${val.toUpperCase()}`;
						anyColor = true;
					}
				}
			}
		}
		const explEl = firstChildElement(c, qname("c", "explosion", NS_C));
		if (explEl) {
			const v = getAttrValue(explEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n) && n > 0) {
					explosions[idx] = n;
					anyExplosion = true;
				}
			}
		}
	}
	return {
		colors: anyColor ? colors : void 0,
		explosions: anyExplosion ? explosions : void 0
	};
};
const readTrendline = (ser) => {
	const tl = firstChildElement(ser, qname("c", "trendline", NS_C));
	if (!tl) return void 0;
	let name;
	const nameEl = firstChildElement(tl, qname("c", "name", NS_C));
	if (nameEl) {
		let acc = "";
		for (const child of nameEl.children) if (child.kind === "text" || child.kind === "cdata") acc += child.data;
		if (acc.length > 0) name = acc;
	}
	const typeEl = firstChildElement(tl, qname("c", "trendlineType", NS_C));
	const tToken = typeEl ? getAttrValue(typeEl, ATTR_VAL) : null;
	let type;
	switch (tToken) {
		case "exp":
		case "log":
		case "poly":
		case "power":
		case "movingAvg":
		case "linear":
			type = tToken;
			break;
		default: type = "linear";
	}
	let period;
	if (type === "movingAvg") {
		const pEl = firstChildElement(tl, qname("c", "period", NS_C));
		if (pEl) {
			const v = getAttrValue(pEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n) && n > 0) period = n;
			}
		}
	}
	let order;
	if (type === "poly") {
		const oEl = firstChildElement(tl, qname("c", "order", NS_C));
		if (oEl) {
			const v = getAttrValue(oEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n) && n >= 2) order = n;
			}
		}
	}
	let color;
	const spPr = firstChildElement(tl, NAME_SP_PR_C);
	if (spPr) {
		const ln = firstChildElement(spPr, qname("a", "ln", NS_A));
		if (ln) {
			const solid = firstChildElement(ln, NAME_SOLID_FILL$1);
			if (solid) {
				const srgb = firstChildElement(solid, NAME_SRGB_CLR);
				if (srgb) {
					const v = getAttrValue(srgb, ATTR_VAL);
					if (v !== null) color = `#${v.toUpperCase()}`;
				}
			}
		}
	}
	const readExtension = (local) => {
		const el = firstChildElement(tl, qname("c", local, NS_C));
		if (!el) return void 0;
		const raw = getAttrValue(el, ATTR_VAL);
		if (raw === null) return void 0;
		const n = Number.parseFloat(raw);
		return Number.isFinite(n) && n > 0 ? n : void 0;
	};
	const forward = readExtension("forward");
	const backward = readExtension("backward");
	const readDispBool = (local) => {
		const el = firstChildElement(tl, qname("c", local, NS_C));
		if (!el) return void 0;
		const v = getAttrValue(el, ATTR_VAL);
		return v === null || v === "1" || v === "true" ? true : void 0;
	};
	const displayEquation = readDispBool("dispEq");
	const displayRSquared = readDispBool("dispRSqr");
	return {
		...name !== void 0 ? { name } : {},
		type,
		...period !== void 0 ? { period } : {},
		...order !== void 0 ? { order } : {},
		...color !== void 0 ? { color } : {},
		...forward !== void 0 ? { forward } : {},
		...backward !== void 0 ? { backward } : {},
		...displayEquation === true ? { displayEquation: true } : {},
		...displayRSquared === true ? { displayRSquared: true } : {}
	};
};
const readSeriesColor = (ser) => {
	const spPr = firstChildElement(ser, NAME_SP_PR_C);
	if (!spPr) return void 0;
	const solidFill = firstChildElement(spPr, NAME_SOLID_FILL$1);
	if (!solidFill) return void 0;
	const srgb = firstChildElement(solidFill, NAME_SRGB_CLR);
	if (!srgb) return void 0;
	const v = getAttrValue(srgb, ATTR_VAL);
	return v !== null ? `#${v.toUpperCase()}` : void 0;
};
const readSolidSrgb = (host) => {
	const fill = host !== null ? firstChildElement(host, NAME_SOLID_FILL$1) : null;
	const srgb = fill !== null ? firstChildElement(fill, NAME_SRGB_CLR) : null;
	const color = srgb !== null ? getAttrValue(srgb, ATTR_VAL) : null;
	return color !== null ? `#${color.toUpperCase()}` : void 0;
};
const readSeriesMarker = (ser) => {
	const m = firstChildElement(ser, qname("c", "marker", NS_C));
	if (!m) return {};
	const out = {};
	const spPr = firstChildElement(m, NAME_SP_PR_C);
	const color = readSolidSrgb(spPr);
	if (color !== void 0) out.markerColor = color;
	const lineColor = readSolidSrgb(spPr !== null ? firstChildElement(spPr, qname("a", "ln", NS_A)) : null);
	if (lineColor !== void 0) out.markerLineColor = lineColor;
	const symEl = firstChildElement(m, qname("c", "symbol", NS_C));
	if (symEl) {
		const v = getAttrValue(symEl, ATTR_VAL);
		if (v === "none" || v === "auto" || v === "circle" || v === "square" || v === "diamond" || v === "triangle" || v === "star" || v === "x" || v === "plus" || v === "dash" || v === "dot" || v === "picture") out.markerSymbol = v;
	}
	const sizeEl = firstChildElement(m, qname("c", "size", NS_C));
	if (sizeEl) {
		const v = getAttrValue(sizeEl, ATTR_VAL);
		if (v !== null) {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n) && n > 0) out.markerSizePt = n;
		}
	}
	return out;
};
const readSeriesLineProps = (ser) => {
	const spPr = firstChildElement(ser, NAME_SP_PR_C);
	if (!spPr) return {};
	const ln = firstChildElement(spPr, qname("a", "ln", NS_A));
	if (!ln) return {};
	const out = {};
	const lnFill = firstChildElement(ln, NAME_SOLID_FILL$1);
	const lnSrgb = lnFill !== null ? firstChildElement(lnFill, NAME_SRGB_CLR) : null;
	const lnColor = lnSrgb !== null ? getAttrValue(lnSrgb, ATTR_VAL) : null;
	if (lnColor !== null) out.lineColor = `#${lnColor.toUpperCase()}`;
	const w = getAttrValue(ln, qname("", "w", ""));
	if (w !== null) {
		const n = Number.parseInt(w, 10);
		if (Number.isFinite(n) && n >= 0) out.lineWidthEmu = n;
	}
	const prstDash = firstChildElement(ln, qname("a", "prstDash", NS_A));
	if (prstDash) {
		const v = getAttrValue(prstDash, ATTR_VAL);
		if (v !== null) out.lineDash = v;
	}
	return out;
};
const readTitle = (chart) => {
	const title = firstChildElement(chart, NAME_TITLE);
	if (!title) return void 0;
	const tx = firstChildElement(title, NAME_TX);
	if (!tx) return void 0;
	const rich = firstChildElement(tx, NAME_RICH);
	if (rich) {
		let acc = "";
		for (const p of allChildElements(rich, NAME_P_DML)) for (const r of allChildElements(p, NAME_R_DML)) {
			const tEl = firstChildElement(r, NAME_T);
			if (!tEl) continue;
			for (const child of tEl.children) if (child.kind === "text" || child.kind === "cdata") acc += child.data;
		}
		if (acc.length > 0) return acc;
	}
	const cells = readStringRef(tx);
	if (cells && cells.length > 0) {
		const text = cells.filter((s) => s.length > 0).join(" ");
		if (text.length > 0) return text;
	}
};
const NAME_A_RPR$1 = qname("a", "rPr", NS_A);
const NAME_A_DEF_RPR$1 = qname("a", "defRPr", NS_A);
const NAME_A_PPR$1 = qname("a", "pPr", NS_A);
const NAME_A_SRGB = qname("a", "srgbClr", NS_A);
const NAME_A_LATIN = qname("a", "latin", NS_A);
const NAME_A_CS = qname("a", "cs", NS_A);
const ATTR_TYPEFACE = qname("", "typeface", "");
const readRunStyle = (rPr) => {
	let font;
	let fontComplexScript;
	let sizePt;
	let bold;
	let italic;
	let color;
	const szRaw = getAttrValue(rPr, qname("", "sz", ""));
	if (szRaw !== null) {
		const n = Number.parseInt(szRaw, 10);
		if (Number.isFinite(n) && n > 0) sizePt = n / 100;
	}
	const bRaw = getAttrValue(rPr, qname("", "b", ""));
	if (bRaw !== null) bold = bRaw === "1" || bRaw === "true";
	const iRaw = getAttrValue(rPr, qname("", "i", ""));
	if (iRaw !== null) italic = iRaw === "1" || iRaw === "true";
	const solidFill = firstChildElement(rPr, NAME_SOLID_FILL$1);
	if (solidFill) {
		const srgb = firstChildElement(solidFill, NAME_A_SRGB);
		if (srgb) {
			const v = getAttrValue(srgb, ATTR_VAL);
			if (v !== null) color = `#${v.toUpperCase()}`;
		}
	}
	const latin = firstChildElement(rPr, NAME_A_LATIN);
	if (latin) {
		const tf = getAttrValue(latin, ATTR_TYPEFACE);
		if (tf !== null && tf !== "") font = tf;
	}
	const cs = firstChildElement(rPr, NAME_A_CS);
	if (cs) {
		const tf = getAttrValue(cs, ATTR_TYPEFACE);
		if (tf !== null && tf !== "") fontComplexScript = tf;
	}
	if (font === void 0 && fontComplexScript === void 0 && sizePt === void 0 && bold === void 0 && italic === void 0 && color === void 0) return;
	return {
		...font !== void 0 ? { font } : {},
		...fontComplexScript !== void 0 ? { fontComplexScript } : {},
		...sizePt !== void 0 ? { sizePt } : {},
		...bold !== void 0 ? { bold } : {},
		...italic !== void 0 ? { italic } : {},
		...color !== void 0 ? { color } : {}
	};
};
const readLabelStyle = (richHost) => {
	for (const p of allChildElements(richHost, NAME_P_DML)) {
		let runStyle;
		for (const r of allChildElements(p, NAME_R_DML)) {
			const rPr = firstChildElement(r, NAME_A_RPR$1);
			runStyle = rPr !== null ? readRunStyle(rPr) : void 0;
			if (runStyle !== void 0) break;
		}
		const pPr = firstChildElement(p, NAME_A_PPR$1);
		const defRPr = pPr !== null ? firstChildElement(pPr, NAME_A_DEF_RPR$1) : null;
		const defStyle = defRPr !== null ? readRunStyle(defRPr) : void 0;
		if (runStyle === void 0 && defStyle === void 0) continue;
		return {
			...defStyle,
			...runStyle
		};
	}
};
const readTitleStyleOf = (titleEl) => {
	const tx = firstChildElement(titleEl, NAME_TX);
	if (!tx) return void 0;
	const rich = firstChildElement(tx, NAME_RICH);
	if (!rich) return void 0;
	return readLabelStyle(rich);
};
const readTitleStyle = (chart) => {
	const title = firstChildElement(chart, NAME_TITLE);
	if (!title) return void 0;
	return readTitleStyleOf(title);
};
const readTitleRotationDeg = (titleEl) => {
	const tx = firstChildElement(titleEl, NAME_TX);
	if (!tx) return void 0;
	const rich = firstChildElement(tx, NAME_RICH);
	if (!rich) return void 0;
	const bodyPr = firstChildElement(rich, qname("a", "bodyPr", NS_A));
	if (!bodyPr) return void 0;
	const v = getAttrValue(bodyPr, qname("", "rot", ""));
	if (v === null) return void 0;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? n / 6e4 : void 0;
};
const readDataLabelPosition = (dLbls) => {
	const el = firstChildElement(dLbls, qname("c", "dLblPos", NS_C));
	if (!el) return void 0;
	const v = getAttrValue(el, ATTR_VAL);
	switch (v) {
		case "ctr":
		case "inEnd":
		case "outEnd":
		case "inBase":
		case "t":
		case "b":
		case "l":
		case "r":
		case "bestFit": return v;
		default: return;
	}
};
const readDataLabelSeparator = (dLbls) => {
	const el = firstChildElement(dLbls, qname("c", "separator", NS_C));
	if (!el) return void 0;
	let acc = "";
	for (const c of el.children) if (c.kind === "text" || c.kind === "cdata") acc += c.data;
	return acc.length > 0 ? acc : void 0;
};
const readDataLabelsGroup = (host, inherited) => {
	const readToggle = (local, fallback) => {
		const el = firstChildElement(host, qname("c", local, NS_C));
		return el !== null ? readXmlBool(el) : fallback;
	};
	const nfEl = firstChildElement(host, qname("c", "numFmt", NS_C));
	let numberFormat;
	if (nfEl) {
		const fc = getAttrValue(nfEl, qname("", "formatCode", ""));
		if (fc !== null && fc.length > 0 && fc !== "General") numberFormat = fc;
	}
	const position = readDataLabelPosition(host);
	const separator = readDataLabelSeparator(host);
	const txPrEl = firstChildElement(host, qname("c", "txPr", NS_C));
	const textStyle = txPrEl ? readLabelStyle(txPrEl) : void 0;
	const showBubbleSize = readToggle("showBubbleSize", inherited?.showBubbleSize ?? false);
	const showLegendKey = readToggle("showLegendKey", inherited?.showLegendKey ?? false);
	const spPr = firstChildElement(host, NAME_SP_PR_C);
	const fillColor = spPr !== null ? readSolidSrgb(spPr) : void 0;
	return {
		showValue: readToggle("showVal", inherited?.showValue ?? false),
		showCategory: readToggle("showCatName", inherited?.showCategory ?? false),
		showSeriesName: readToggle("showSerName", inherited?.showSeriesName ?? false),
		showPercent: readToggle("showPercent", inherited?.showPercent ?? false),
		...numberFormat !== void 0 ? { numberFormat } : {},
		...position !== void 0 ? { position } : {},
		...separator !== void 0 ? { separator } : {},
		...textStyle !== void 0 ? { textStyle } : {},
		...showBubbleSize ? { showBubbleSize } : {},
		...showLegendKey ? { showLegendKey } : {},
		...fillColor !== void 0 ? { fillColor } : {}
	};
};
const readRichText = (host) => {
	const tx = firstChildElement(host, NAME_TX);
	const rich = tx !== null ? firstChildElement(tx, NAME_RICH) : null;
	if (rich === null) return void 0;
	const paragraphs = [];
	for (const p of allChildElements(rich, NAME_P_DML)) {
		let line = "";
		for (const r of allChildElements(p, NAME_R_DML)) {
			const t = firstChildElement(r, NAME_T);
			if (t === null) continue;
			for (const child of t.children) if (child.kind === "text" || child.kind === "cdata") line += child.data;
		}
		paragraphs.push(line);
	}
	return paragraphs.join("\n");
};
const readSeriesLevelDataLabels = (dLbls) => {
	const group = readDataLabelsGroup(dLbls, void 0);
	const leaderEl = firstChildElement(dLbls, qname("c", "showLeaderLines", NS_C));
	return leaderEl !== null ? {
		...group,
		showLeaderLines: readXmlBool(leaderEl)
	} : group;
};
const hasDataLabelGroupChild = (dLbls) => dLbls.children.some((ch) => ch.kind === "element" && ch.name.namespaceURI === NS_C && ch.name.localName !== "dLbl" && ch.name.localName !== "extLst");
const DELETED_POINT_LABEL = {
	showValue: false,
	showCategory: false,
	showSeriesName: false,
	showPercent: false
};
const readPointDataLabels = (dLbls, pointCount, seriesLabels) => {
	const out = [];
	let any = false;
	for (const dLbl of allChildElements(dLbls, NAME_D_LBL)) {
		const idx = readPointIndex(dLbl, pointCount);
		if (idx === null) continue;
		const deleteEl = firstChildElement(dLbl, qname("c", "delete", NS_C));
		if (deleteEl !== null && readXmlBool(deleteEl)) out[idx] = DELETED_POINT_LABEL;
		else {
			const group = readDataLabelsGroup(dLbl, seriesLabels);
			const literal = readRichText(dLbl);
			out[idx] = literal !== void 0 ? {
				...group,
				text: literal
			} : group;
		}
		any = true;
	}
	if (!any) return void 0;
	for (let i = 0; i < out.length; i++) out[i] ??= null;
	return out;
};
const readValueAxisScaling = (valAx) => {
	let min;
	let max;
	let majorUnit;
	let minorUnit;
	let logBase;
	let displayUnits;
	let displayUnitsLabel = false;
	const scaling = firstChildElement(valAx, qname("c", "scaling", NS_C));
	const readNumOn = (parent, local) => {
		const el = firstChildElement(parent, qname("c", local, NS_C));
		if (!el) return void 0;
		const v = getAttrValue(el, ATTR_VAL);
		if (v === null) return void 0;
		const n = Number.parseFloat(v);
		return Number.isFinite(n) ? n : void 0;
	};
	if (scaling) {
		min = readNumOn(scaling, "min");
		max = readNumOn(scaling, "max");
		const lb = readNumOn(scaling, "logBase");
		if (lb !== void 0 && lb >= 2 && lb <= 1e3) logBase = lb;
	}
	majorUnit = readNumOn(valAx, "majorUnit");
	minorUnit = readNumOn(valAx, "minorUnit");
	const dispUnits = firstChildElement(valAx, qname("c", "dispUnits", NS_C));
	if (dispUnits) {
		const builtIn = firstChildElement(dispUnits, qname("c", "builtInUnit", NS_C));
		if (builtIn) {
			const v = getAttrValue(builtIn, ATTR_VAL);
			switch (v) {
				case "hundreds":
				case "thousands":
				case "tenThousands":
				case "hundredThousands":
				case "millions":
				case "tenMillions":
				case "hundredMillions":
				case "billions":
				case "trillions":
					displayUnits = v;
					break;
			}
		}
		displayUnitsLabel = firstChildElement(dispUnits, qname("c", "dispUnitsLbl", NS_C)) !== null;
	}
	let numberFormat;
	const nfEl = firstChildElement(valAx, qname("c", "numFmt", NS_C));
	if (nfEl) {
		const fc = getAttrValue(nfEl, qname("", "formatCode", ""));
		if (fc !== null && fc.length > 0 && fc !== "General") numberFormat = fc;
	}
	if (min !== void 0 || max !== void 0 || majorUnit !== void 0 || minorUnit !== void 0 || numberFormat !== void 0 || logBase !== void 0 || displayUnits !== void 0) return {
		...min !== void 0 ? { min } : {},
		...max !== void 0 ? { max } : {},
		...majorUnit !== void 0 ? { majorUnit } : {},
		...minorUnit !== void 0 ? { minorUnit } : {},
		...numberFormat !== void 0 ? { numberFormat } : {},
		...logBase !== void 0 ? { logBase } : {},
		...displayUnits !== void 0 ? { displayUnits } : {},
		...displayUnits !== void 0 && displayUnitsLabel ? { displayUnitsLabel } : {}
	};
};
const childVal = (parent, local) => {
	const el = firstChildElement(parent, qname("c", local, NS_C));
	return el !== null ? getAttrValue(el, ATTR_VAL) : null;
};
const childNumber = (parent, local) => {
	const raw = childVal(parent, local);
	if (raw === null) return void 0;
	const n = Number.parseFloat(raw);
	return Number.isFinite(n) ? n : void 0;
};
const childBool = (parent, local) => {
	const el = firstChildElement(parent, qname("c", local, NS_C));
	return el !== null ? readXmlBool(el) : void 0;
};
const childToken = (parent, local, allowed) => {
	const raw = childVal(parent, local);
	return allowed.find((token) => token === raw);
};
const ALPHA_OPAQUE = 1e5;
const readSeriesFillOpacity = (ser) => {
	const spPr = firstChildElement(ser, NAME_SP_PR_C);
	const fill = spPr !== null ? firstChildElement(spPr, NAME_SOLID_FILL$1) : null;
	const srgb = fill !== null ? firstChildElement(fill, NAME_SRGB_CLR) : null;
	const alpha = srgb !== null ? firstChildElement(srgb, qname("a", "alpha", NS_A)) : null;
	const raw = alpha !== null ? getAttrValue(alpha, ATTR_VAL) : null;
	if (raw === null || !/^\d+$/.test(raw)) return void 0;
	const n = Number.parseInt(raw, 10);
	return n <= ALPHA_OPAQUE ? n / ALPHA_OPAQUE : void 0;
};
const readErrorBarAmount = (errBars) => {
	const type = childToken(errBars, "errValType", [
		"cust",
		"fixedVal",
		"percentage",
		"stdDev",
		"stdErr"
	]);
	if (type === void 0) return void 0;
	if (type === "stdErr") return { type };
	if (type === "cust") {
		const side = (local) => {
			const el = firstChildElement(errBars, qname("c", local, NS_C));
			return el !== null ? readNumChannel(el) ?? void 0 : void 0;
		};
		const plus = side("plus");
		const minus = side("minus");
		return {
			type,
			...plus !== void 0 ? { plus } : {},
			...minus !== void 0 ? { minus } : {}
		};
	}
	const value = childNumber(errBars, "val");
	return value !== void 0 ? {
		type,
		value
	} : void 0;
};
const readErrorBars = (ser) => {
	const out = {};
	for (const el of allChildElements(ser, qname("c", "errBars", NS_C))) {
		const barType = childToken(el, "errBarType", [
			"both",
			"minus",
			"plus"
		]);
		const amount = readErrorBarAmount(el);
		if (barType === void 0 || amount === void 0) continue;
		const noEndCap = childBool(el, "noEndCap");
		const spPr = firstChildElement(el, NAME_SP_PR_C);
		const ln = spPr !== null ? firstChildElement(spPr, qname("a", "ln", NS_A)) : null;
		const color = readSolidSrgb(ln);
		const w = ln !== null ? getAttrValue(ln, qname("", "w", "")) : null;
		const bars = {
			barType,
			amount,
			...noEndCap !== void 0 ? { noEndCap } : {},
			...color !== void 0 ? { color } : {},
			...w !== null && /^\d+$/.test(w) ? { lineWidthEmu: Number.parseInt(w, 10) } : {}
		};
		if (childVal(el, "errDir") === "x") out.xErrorBars ??= bars;
		else out.errorBars ??= bars;
	}
	return out;
};
const readView3D = (chart) => {
	const el = firstChildElement(chart, qname("c", "view3D", NS_C));
	if (el === null) return void 0;
	const rotX = childNumber(el, "rotX");
	const rotY = childNumber(el, "rotY");
	const rightAngleAxes = childBool(el, "rAngAx");
	const perspective = childNumber(el, "perspective");
	const depthPercent = childNumber(el, "depthPercent");
	const heightPercent = childNumber(el, "hPercent");
	return {
		...rotX !== void 0 ? { rotX } : {},
		...rotY !== void 0 ? { rotY } : {},
		...rightAngleAxes !== void 0 ? { rightAngleAxes } : {},
		...perspective !== void 0 ? { perspective } : {},
		...depthPercent !== void 0 ? { depthPercent } : {},
		...heightPercent !== void 0 ? { heightPercent } : {}
	};
};
const readOfPie = (group) => {
	const type = childToken(group, "ofPieType", ["pie", "bar"]);
	if (type === void 0) return void 0;
	const splitType = childToken(group, "splitType", [
		"auto",
		"cust",
		"percent",
		"pos",
		"val"
	]);
	const splitPos = childNumber(group, "splitPos");
	const secondPieSizePct = childNumber(group, "secondPieSize");
	const gapWidthPct = childNumber(group, "gapWidth");
	const custSplit = firstChildElement(group, qname("c", "custSplit", NS_C));
	const customSplit = [];
	if (custSplit !== null) for (const pt of allChildElements(custSplit, qname("c", "secondPiePt", NS_C))) {
		const idx = parsePointIndex(getAttrValue(pt, ATTR_VAL), MAX_PT_COUNT);
		if (idx !== null) customSplit.push(idx);
	}
	const seriesLines = firstChildElement(group, qname("c", "serLines", NS_C)) !== null;
	return {
		type,
		...splitType !== void 0 ? { splitType } : {},
		...splitPos !== void 0 ? { splitPos } : {},
		...custSplit !== null ? { customSplit } : {},
		...secondPieSizePct !== void 0 ? { secondPieSizePct } : {},
		...gapWidthPct !== void 0 ? { gapWidthPct } : {},
		...seriesLines ? { seriesLines } : {}
	};
};
const readUpDownBars = (group) => {
	const el = firstChildElement(group, qname("c", "upDownBars", NS_C));
	if (el === null) return void 0;
	const barColor = (local) => {
		const bar = firstChildElement(el, qname("c", local, NS_C));
		return readSolidSrgb(bar !== null ? firstChildElement(bar, NAME_SP_PR_C) : null);
	};
	const gapWidthPct = childNumber(el, "gapWidth");
	const upColor = barColor("upBars");
	const downColor = barColor("downBars");
	return {
		...gapWidthPct !== void 0 ? { gapWidthPct } : {},
		...upColor !== void 0 ? { upColor } : {},
		...downColor !== void 0 ? { downColor } : {}
	};
};
const readDataTable = (plotArea) => {
	const el = firstChildElement(plotArea, qname("c", "dTable", NS_C));
	if (el === null) return void 0;
	const showHorizontalBorder = childBool(el, "showHorzBorder");
	const showVerticalBorder = childBool(el, "showVertBorder");
	const showOutline = childBool(el, "showOutline");
	const showKeys = childBool(el, "showKeys");
	const txPr = firstChildElement(el, qname("c", "txPr", NS_C));
	const textStyle = txPr !== null ? readLabelStyle(txPr) : void 0;
	return {
		...showHorizontalBorder !== void 0 ? { showHorizontalBorder } : {},
		...showVerticalBorder !== void 0 ? { showVerticalBorder } : {},
		...showOutline !== void 0 ? { showOutline } : {},
		...showKeys !== void 0 ? { showKeys } : {},
		...textStyle !== void 0 ? { textStyle } : {}
	};
};
const TIME_UNITS = [
	"days",
	"months",
	"years"
];
const readDateAxis = (dateAx) => {
	const baseTimeUnit = childToken(dateAx, "baseTimeUnit", TIME_UNITS);
	const majorUnit = childNumber(dateAx, "majorUnit");
	const majorTimeUnit = childToken(dateAx, "majorTimeUnit", TIME_UNITS);
	const minorUnit = childNumber(dateAx, "minorUnit");
	const minorTimeUnit = childToken(dateAx, "minorTimeUnit", TIME_UNITS);
	return {
		...baseTimeUnit !== void 0 ? { baseTimeUnit } : {},
		...majorUnit !== void 0 ? { majorUnit } : {},
		...majorTimeUnit !== void 0 ? { majorTimeUnit } : {},
		...minorUnit !== void 0 ? { minorUnit } : {},
		...minorTimeUnit !== void 0 ? { minorTimeUnit } : {}
	};
};
const withoutNumberFormat = (scaling) => {
	if (scaling === void 0) return void 0;
	const { numberFormat: _numberFormat, ...rest } = scaling;
	return Object.keys(rest).length > 0 ? rest : void 0;
};
const minMaxOnly = (scaling) => {
	if (scaling?.min === void 0 && scaling?.max === void 0) return void 0;
	return {
		...scaling.min !== void 0 ? { min: scaling.min } : {},
		...scaling.max !== void 0 ? { max: scaling.max } : {}
	};
};
const isAxisLineHidden = (axis) => {
	const spPr = firstChildElement(axis, NAME_SP_PR_C);
	const ln = spPr !== null ? firstChildElement(spPr, qname("a", "ln", NS_A)) : null;
	return ln !== null && firstChildElement(ln, qname("a", "noFill", NS_A)) !== null;
};
const readSeriesAxis = (plotArea) => {
	const el = firstChildElement(plotArea, qname("c", "serAx", NS_C));
	if (el === null) return void 0;
	const hidden = childBool(el, "delete");
	const title = readTitle(el);
	const titleEl = firstChildElement(el, NAME_TITLE);
	const titleStyle = titleEl !== null ? readTitleStyleOf(titleEl) : void 0;
	const txPr = firstChildElement(el, qname("c", "txPr", NS_C));
	const labelStyle = txPr !== null ? readLabelStyle(txPr) : void 0;
	const majorGridlines = firstChildElement(el, qname("c", "majorGridlines", NS_C)) !== null;
	const scaling = firstChildElement(el, qname("c", "scaling", NS_C));
	const orientation = scaling !== null ? childToken(scaling, "orientation", ["minMax", "maxMin"]) : void 0;
	const tickLabelPos = childToken(el, "tickLblPos", [
		"none",
		"low",
		"high",
		"nextTo"
	]);
	const tickLabelSkip = childNumber(el, "tickLblSkip");
	const spPr = firstChildElement(el, NAME_SP_PR_C);
	const lineColor = readSolidSrgb(spPr !== null ? firstChildElement(spPr, qname("a", "ln", NS_A)) : null);
	const fields = {
		...hidden === true ? { hidden } : {},
		...title !== void 0 ? { title } : {},
		...titleStyle !== void 0 ? { titleStyle } : {},
		...labelStyle !== void 0 ? { labelStyle } : {},
		...majorGridlines ? { majorGridlines } : {},
		...orientation === "maxMin" ? { orientation } : {},
		...tickLabelPos !== void 0 ? { tickLabelPos } : {},
		...tickLabelSkip !== void 0 ? { tickLabelSkip } : {},
		...lineColor !== void 0 ? { lineColor } : {}
	};
	return Object.keys(fields).length > 0 ? fields : void 0;
};
const readManualLayout = (host) => {
	const layout = firstChildElement(host, qname("c", "layout", NS_C));
	const manual = layout !== null ? firstChildElement(layout, qname("c", "manualLayout", NS_C)) : null;
	if (manual === null) return void 0;
	if (childVal(manual, "xMode") !== "edge" || childVal(manual, "yMode") !== "edge") return void 0;
	const sizeMode = (local) => (childVal(manual, local) ?? "factor") === "factor";
	if (!sizeMode("wMode") || !sizeMode("hMode")) return void 0;
	const x = childNumber(manual, "x");
	const y = childNumber(manual, "y");
	if (x === void 0 || y === void 0) return void 0;
	const w = childNumber(manual, "w");
	const h = childNumber(manual, "h");
	const target = childToken(manual, "layoutTarget", ["inner", "outer"]);
	return {
		x,
		y,
		...w !== void 0 ? { w } : {},
		...h !== void 0 ? { h } : {},
		...target !== void 0 ? { target } : {}
	};
};
const readBoxLayout = (host) => {
	const layout = readManualLayout(host);
	if (layout === void 0 || layout.w === void 0 || layout.h === void 0) return void 0;
	return {
		x: layout.x,
		y: layout.y,
		w: layout.w,
		h: layout.h,
		...layout.target !== void 0 ? { target: layout.target } : {}
	};
};
const readCategoryGroupLevels = (cat) => {
	const multi = firstChildElement(cat, NAME_MULTI_LVL_STR_REF);
	const cache = multi !== null ? firstChildElement(multi, NAME_MULTI_LVL_STR_CACHE) : null;
	if (cache === null) return void 0;
	const outer = allChildElements(cache, NAME_LVL).slice(1).map((lvl) => readPtArray(lvl, cache));
	return outer.length > 0 ? outer : void 0;
};
/**
* Parses a `<c:chartSpace>` element into a typed `ReadChartSpec`. Throws if
* the root or any required child is missing. Returns `null` only when
* the chart is structurally well-formed but uses a kind we don't model
* (so callers can fall through to pass-through).
*/
const readChartSpec = (root) => {
	if (root.name.namespaceURI !== NS_C || root.name.localName !== "chartSpace") throw new Error(`expected <c:chartSpace> root, got <${root.name.prefix}:${root.name.localName}>`);
	const chart = firstChildElement(root, NAME_CHART);
	if (!chart) throw new Error("<c:chartSpace> has no <c:chart>");
	const plotArea = firstChildElement(chart, NAME_PLOT_AREA);
	if (!plotArea) throw new Error("<c:chart> has no <c:plotArea>");
	const kindByLocalName = new Map(KIND_MAP.map((entry) => [entry.localName, entry]));
	const plotGroups = [];
	for (const child of plotArea.children) {
		if (child.kind !== "element" || child.name.namespaceURI !== NS_C) continue;
		const mapped = kindByLocalName.get(child.name.localName);
		if (!mapped) continue;
		let groupKind = mapped.kind;
		if (mapped.localName === "barChart" || mapped.localName === "bar3DChart") {
			const barDir = firstChildElement(child, qname("c", "barDir", NS_C));
			groupKind = (barDir !== null ? getAttrValue(barDir, ATTR_VAL) : null) === "bar" ? "bar" : "column";
		}
		plotGroups.push({
			element: child,
			kind: groupKind
		});
	}
	const firstGroup = plotGroups[0];
	if (!firstGroup) return null;
	const plotted = firstGroup.element;
	const kind = firstGroup.kind;
	const groupAxisIds = (group) => {
		const ids = [];
		for (const axIdEl of allChildElements(group, qname("c", "axId", NS_C))) {
			const id = getAttrValue(axIdEl, ATTR_VAL);
			if (id !== null) ids.push(id);
		}
		return ids;
	};
	const valAxisIds = /* @__PURE__ */ new Set();
	for (const el of allChildElements(plotArea, NAME_VAL_AX)) {
		const axIdEl = firstChildElement(el, qname("c", "axId", NS_C));
		const id = axIdEl !== null ? getAttrValue(axIdEl, ATTR_VAL) : null;
		if (id !== null) valAxisIds.add(id);
	}
	const primaryAxisIds = new Set(groupAxisIds(plotted));
	const secondaryValAxisIds = /* @__PURE__ */ new Set();
	for (const group of plotGroups.slice(1)) for (const id of groupAxisIds(group.element)) if (valAxisIds.has(id) && !primaryAxisIds.has(id)) secondaryValAxisIds.add(id);
	const groupUsesSecondaryAxis = (group) => groupAxisIds(group).some((id) => secondaryValAxisIds.has(id));
	const series = [];
	let categoriesFromFirst = null;
	let categoryGroupLevels;
	const serEntries = [];
	for (const group of plotGroups) {
		const secondary = groupUsesSecondaryAxis(group.element);
		for (const ser of allChildElements(group.element, NAME_SER)) serEntries.push({
			ser,
			groupKind: group.kind,
			secondary
		});
	}
	for (const { ser, groupKind, secondary } of serEntries) {
		const name = readSeriesName(ser);
		const cat = firstChildElement(ser, NAME_CAT);
		if (cat !== null && categoriesFromFirst === null) {
			categoriesFromFirst = readStringRef(cat) ?? null;
			categoryGroupLevels = readCategoryGroupLevels(cat);
			if (categoriesFromFirst === null) {
				const nums = readNumRef(cat);
				if (nums !== null) categoriesFromFirst = nums.map((n) => n === null || !Number.isFinite(n) ? "" : String(n));
			}
		}
		let valEl = firstChildElement(ser, NAME_VAL);
		if (!valEl) valEl = firstChildElement(ser, qname("c", "yVal", NS_C));
		const values = valEl !== null ? readNumRef(valEl) : null;
		const xValEl = firstChildElement(ser, qname("c", "xVal", NS_C));
		const xValues = xValEl !== null ? readNumRef(xValEl) : null;
		const bubbleSizeEl = firstChildElement(ser, qname("c", "bubbleSize", NS_C));
		const bubbleSizes = bubbleSizeEl !== null ? readNumRef(bubbleSizeEl) : null;
		const color = readSeriesColor(ser);
		const { lineWidthEmu, lineColor, lineDash } = readSeriesLineProps(ser);
		const { markerSymbol, markerSizePt, markerColor, markerLineColor } = readSeriesMarker(ser);
		const invertEl = firstChildElement(ser, qname("c", "invertIfNegative", NS_C));
		const invertIfNegative = invertEl !== null && readXmlBool(invertEl) ? true : void 0;
		const pointCount = values !== null ? values.length : 0;
		const { colors: pointColors, explosions: pointExplosions } = readDataPointOverrides(ser, pointCount);
		const smoothEl = firstChildElement(ser, qname("c", "smooth", NS_C));
		const smooth = smoothEl !== null && readXmlBool(smoothEl);
		const trendline = readTrendline(ser);
		const fillOpacity = readSeriesFillOpacity(ser);
		const { errorBars, xErrorBars } = readErrorBars(ser);
		const serDLblsEl = firstChildElement(ser, NAME_D_LBLS);
		const serDataLabels = serDLblsEl !== null && hasDataLabelGroupChild(serDLblsEl) ? readSeriesLevelDataLabels(serDLblsEl) : void 0;
		const pointDataLabels = serDLblsEl !== null ? readPointDataLabels(serDLblsEl, pointCount, serDataLabels) : void 0;
		series.push({
			name,
			values: values ?? [],
			...groupKind !== kind && isComboSeriesKind(groupKind) ? { chartKind: groupKind } : {},
			...secondary ? { secondaryAxis: true } : {},
			...xValues !== null ? { xValues } : {},
			...bubbleSizes !== null ? { bubbleSizes } : {},
			...color !== void 0 ? { color } : {},
			...lineWidthEmu !== void 0 ? { lineWidthEmu } : {},
			...lineColor !== void 0 ? { lineColor } : {},
			...lineDash !== void 0 ? { lineDash } : {},
			...markerSymbol !== void 0 ? { markerSymbol } : {},
			...markerSizePt !== void 0 ? { markerSizePt } : {},
			...markerColor !== void 0 ? { markerColor } : {},
			...markerLineColor !== void 0 ? { markerLineColor } : {},
			...invertIfNegative !== void 0 ? { invertIfNegative } : {},
			...pointColors !== void 0 ? { pointColors } : {},
			...pointExplosions !== void 0 ? { pointExplosions } : {},
			...pointDataLabels !== void 0 ? { pointDataLabels } : {},
			...smoothEl !== null ? { smooth } : {},
			...trendline !== void 0 ? { trendline } : {},
			...serDataLabels !== void 0 ? { dataLabels: serDataLabels } : {},
			...fillOpacity !== void 0 ? { fillOpacity } : {},
			...errorBars !== void 0 ? { errorBars } : {},
			...xErrorBars !== void 0 ? { xErrorBars } : {}
		});
	}
	const categories = categoriesFromFirst ?? [];
	const title = readTitle(chart);
	const titleStyle = readTitleStyle(chart);
	const dLbls = firstChildElement(plotted, NAME_D_LBLS);
	const dataLabels = dLbls !== null ? readSeriesLevelDataLabels(dLbls) : void 0;
	let valAx = null;
	let secValAx = null;
	for (const el of allChildElements(plotArea, NAME_VAL_AX)) {
		const axIdEl = firstChildElement(el, qname("c", "axId", NS_C));
		const id = axIdEl !== null ? getAttrValue(axIdEl, ATTR_VAL) : null;
		if (id !== null && secondaryValAxisIds.has(id)) secValAx ??= el;
		else valAx ??= el;
	}
	if (valAx === null) {
		valAx = secValAx;
		secValAx = null;
	}
	const isXyKind = kind === "scatter" || kind === "bubble";
	let xValAx = null;
	if (isXyKind) {
		const [xId, yId] = groupAxisIds(plotted);
		const valAxById = /* @__PURE__ */ new Map();
		for (const el of allChildElements(plotArea, NAME_VAL_AX)) {
			const id = childVal(el, "axId");
			if (id !== null) valAxById.set(id, el);
		}
		const x = xId !== void 0 ? valAxById.get(xId) : void 0;
		const y = yId !== void 0 ? valAxById.get(yId) : void 0;
		if (x !== void 0 && y !== void 0) {
			xValAx = x;
			valAx = y;
		}
	}
	const valueAxis = valAx !== null ? readValueAxisScaling(valAx) : void 0;
	let grouping;
	if (kind === "column" || kind === "bar" || kind === "area" || kind === "line") {
		const groupingEl = firstChildElement(plotted, qname("c", "grouping", NS_C));
		if (groupingEl) {
			const g = getAttrValue(groupingEl, ATTR_VAL);
			if (g === "clustered" || g === "stacked" || g === "percentStacked" || g === "standard") grouping = g;
		}
	}
	const dropLinesEl = firstChildElement(plotted, qname("c", "dropLines", NS_C));
	const hiLowLinesEl = firstChildElement(plotted, qname("c", "hiLowLines", NS_C));
	const dropLines = dropLinesEl !== null ? true : void 0;
	const hiLowLines = hiLowLinesEl !== null ? true : void 0;
	let lineMarkers;
	if (plotted.name.localName === "lineChart") {
		const markerEl = firstChildElement(plotted, qname("c", "marker", NS_C));
		if (markerEl === null) lineMarkers = false;
		else {
			const v = getAttrValue(markerEl, ATTR_VAL);
			lineMarkers = v === null ? true : v === "1" || v === "true";
		}
	}
	let gapWidthPct;
	let overlapPct;
	if (kind === "column" || kind === "bar") {
		const gwEl = firstChildElement(plotted, qname("c", "gapWidth", NS_C));
		if (gwEl) {
			const v = getAttrValue(gwEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n)) gapWidthPct = n;
			}
		}
		const ovEl = firstChildElement(plotted, qname("c", "overlap", NS_C));
		if (ovEl) {
			const v = getAttrValue(ovEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n)) overlapPct = n;
			}
		}
	}
	let categoryAxisTitle;
	let categoryAxisTitleStyle;
	let categoryAxisTitleRotationDeg;
	let categoryAxisLabelStyle;
	let categoryAxisLabelRotationDeg;
	let valueAxisLabelRotationDeg;
	let valueAxisMajorTickMark;
	let categoryAxisMajorTickMark;
	let valueAxisMinorTickMark;
	let categoryAxisMinorTickMark;
	const readTickMarkLocal = (axis, local) => {
		const el = firstChildElement(axis, qname("c", local, NS_C));
		if (!el) return void 0;
		const v = getAttrValue(el, ATTR_VAL);
		if (v === "in" || v === "out" || v === "cross" || v === "none") return v;
	};
	const readTickMark = (axis) => readTickMarkLocal(axis, "majorTickMark");
	let valueAxisTitle;
	let valueAxisTitleStyle;
	let valueAxisTitleRotationDeg;
	let valueAxisLabelStyle;
	let categoryAxisHidden;
	let valueAxisHidden;
	let categoryAxisTickLabelSkip;
	let categoryAxisTickMarkSkip;
	let categoryAxisTickLabelPos;
	let categoryAxisLabelOffset;
	let categoryAxisLabelAlign;
	let categoryAxisNumberFormat;
	let categoryAxisNoMultiLevelLabel;
	let categoryAxisLineColor;
	let valueAxisLineColor;
	let categoryAxisMajorGridlines;
	let categoryAxisMinorGridlines;
	let categoryAxisMajorGridlineColor;
	let categoryAxisMinorGridlineColor;
	let valueAxisMinorGridlineColor;
	let categoryAxisLineWidthEmu;
	let valueAxisLineWidthEmu;
	let categoryAxisMajorGridlineWidthEmu;
	let categoryAxisMinorGridlineWidthEmu;
	let valueAxisMajorGridlineWidthEmu;
	let valueAxisMinorGridlineWidthEmu;
	const readGridlineColor = (gl) => {
		const spPr = firstChildElement(gl, NAME_SP_PR_C);
		if (!spPr) return void 0;
		const ln = firstChildElement(spPr, qname("a", "ln", NS_A));
		if (!ln) return void 0;
		const solid = firstChildElement(ln, NAME_SOLID_FILL$1);
		if (!solid) return void 0;
		const srgb = firstChildElement(solid, NAME_SRGB_CLR);
		if (!srgb) return void 0;
		const v = getAttrValue(srgb, ATTR_VAL);
		return v !== null ? `#${v.toUpperCase()}` : void 0;
	};
	const readLineWidthEmu = (host) => {
		const spPr = firstChildElement(host, NAME_SP_PR_C);
		const ln = spPr !== null ? firstChildElement(spPr, qname("a", "ln", NS_A)) : null;
		const w = ln !== null ? getAttrValue(ln, qname("", "w", "")) : null;
		if (w === null || !/^\d+$/.test(w)) return void 0;
		return Number.parseInt(w, 10);
	};
	const readAxisLineColor = (axis) => {
		const spPr = firstChildElement(axis, NAME_SP_PR_C);
		if (!spPr) return void 0;
		const ln = firstChildElement(spPr, qname("a", "ln", NS_A));
		if (!ln) return void 0;
		const solid = firstChildElement(ln, NAME_SOLID_FILL$1);
		if (!solid) return void 0;
		const srgb = firstChildElement(solid, NAME_SRGB_CLR);
		if (!srgb) return void 0;
		const v = getAttrValue(srgb, ATTR_VAL);
		return v !== null ? `#${v.toUpperCase()}` : void 0;
	};
	const catAx = xValAx ?? findFirst(plotArea, ["catAx", "dateAx"]);
	const isHidden = (axis) => {
		const d = firstChildElement(axis, qname("c", "delete", NS_C));
		if (!d) return void 0;
		const v = getAttrValue(d, ATTR_VAL);
		return v === null || v === "1" || v === "true";
	};
	let categoryAxisOrientation;
	let valueAxisOrientation;
	let valueAxisCrosses;
	let valueAxisCrossBetween;
	let valueAxisTickLabelPos;
	const readAxisOrientation = (axis) => {
		const scaling = firstChildElement(axis, qname("c", "scaling", NS_C));
		if (!scaling) return void 0;
		const orientationEl = firstChildElement(scaling, qname("c", "orientation", NS_C));
		if (!orientationEl) return void 0;
		const v = getAttrValue(orientationEl, ATTR_VAL);
		if (v === "minMax" || v === "maxMin") return v;
	};
	if (catAx) {
		const t = readTitle(catAx);
		if (t !== void 0) categoryAxisTitle = t;
		const catTitleEl = firstChildElement(catAx, NAME_TITLE);
		if (catTitleEl) {
			categoryAxisTitleStyle = readTitleStyleOf(catTitleEl);
			categoryAxisTitleRotationDeg = readTitleRotationDeg(catTitleEl);
		}
		const catTxPr = firstChildElement(catAx, qname("c", "txPr", NS_C));
		if (catTxPr) {
			categoryAxisLabelStyle = readLabelStyle(catTxPr);
			const bodyPr = firstChildElement(catTxPr, qname("a", "bodyPr", NS_A));
			if (bodyPr) {
				const rotRaw = getAttrValue(bodyPr, qname("", "rot", ""));
				if (rotRaw !== null) {
					const n = Number.parseInt(rotRaw, 10);
					if (Number.isFinite(n)) categoryAxisLabelRotationDeg = n / 6e4;
				}
			}
		}
		categoryAxisHidden = isHidden(catAx);
		categoryAxisLineColor = readAxisLineColor(catAx);
		categoryAxisLineWidthEmu = readLineWidthEmu(catAx);
		const catMajorGl = firstChildElement(catAx, qname("c", "majorGridlines", NS_C));
		categoryAxisMajorGridlines = catMajorGl !== null;
		if (catMajorGl) {
			categoryAxisMajorGridlineColor = readGridlineColor(catMajorGl);
			categoryAxisMajorGridlineWidthEmu = readLineWidthEmu(catMajorGl);
		}
		const catMinorGl = firstChildElement(catAx, qname("c", "minorGridlines", NS_C));
		categoryAxisMinorGridlines = catMinorGl !== null;
		if (catMinorGl) {
			categoryAxisMinorGridlineColor = readGridlineColor(catMinorGl);
			categoryAxisMinorGridlineWidthEmu = readLineWidthEmu(catMinorGl);
		}
		categoryAxisOrientation = readAxisOrientation(catAx);
		categoryAxisMajorTickMark = readTickMark(catAx);
		categoryAxisMinorTickMark = readTickMarkLocal(catAx, "minorTickMark");
		const skipEl = firstChildElement(catAx, qname("c", "tickLblSkip", NS_C));
		if (skipEl) {
			const v = getAttrValue(skipEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n) && n > 1) categoryAxisTickLabelSkip = n;
			}
		}
		const markSkipEl = firstChildElement(catAx, qname("c", "tickMarkSkip", NS_C));
		if (markSkipEl) {
			const v = getAttrValue(markSkipEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n) && n > 1) categoryAxisTickMarkSkip = n;
			}
		}
		const posEl = firstChildElement(catAx, qname("c", "tickLblPos", NS_C));
		if (posEl) {
			const v = getAttrValue(posEl, ATTR_VAL);
			if (v === "none" || v === "low" || v === "high" || v === "nextTo") categoryAxisTickLabelPos = v;
		}
		const lblOffsetEl = firstChildElement(catAx, qname("c", "lblOffset", NS_C));
		if (lblOffsetEl) {
			const v = getAttrValue(lblOffsetEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n) && n !== 100) categoryAxisLabelOffset = n;
			}
		}
		const lblAlgnEl = firstChildElement(catAx, qname("c", "lblAlgn", NS_C));
		if (lblAlgnEl) {
			const v = getAttrValue(lblAlgnEl, ATTR_VAL);
			if (v === "ctr" || v === "l" || v === "r") categoryAxisLabelAlign = v;
		}
		const catNumFmtEl = firstChildElement(catAx, qname("c", "numFmt", NS_C));
		if (catNumFmtEl) {
			const fc = getAttrValue(catNumFmtEl, qname("", "formatCode", ""));
			if (fc !== null && fc.length > 0 && fc !== "General") categoryAxisNumberFormat = fc;
		}
		const noMultiLvlEl = firstChildElement(catAx, qname("c", "noMultiLvlLbl", NS_C));
		if (noMultiLvlEl) {
			const v = getAttrValue(noMultiLvlEl, ATTR_VAL);
			if (v === "1" || v === "true") categoryAxisNoMultiLevelLabel = true;
		}
	}
	let valueAxisMajorGridlines;
	let valueAxisMinorGridlines;
	let valueAxisMajorGridlineColor;
	if (valAx) {
		const t = readTitle(valAx);
		if (t !== void 0) valueAxisTitle = t;
		const valTitleEl = firstChildElement(valAx, NAME_TITLE);
		if (valTitleEl) {
			valueAxisTitleStyle = readTitleStyleOf(valTitleEl);
			valueAxisTitleRotationDeg = readTitleRotationDeg(valTitleEl);
		}
		const valTxPr = firstChildElement(valAx, qname("c", "txPr", NS_C));
		if (valTxPr) {
			valueAxisLabelStyle = readLabelStyle(valTxPr);
			const bodyPr = firstChildElement(valTxPr, qname("a", "bodyPr", NS_A));
			if (bodyPr) {
				const rotRaw = getAttrValue(bodyPr, qname("", "rot", ""));
				if (rotRaw !== null) {
					const n = Number.parseInt(rotRaw, 10);
					if (Number.isFinite(n)) valueAxisLabelRotationDeg = n / 6e4;
				}
			}
		}
		valueAxisHidden = isHidden(valAx);
		valueAxisLineColor = readAxisLineColor(valAx);
		valueAxisLineWidthEmu = readLineWidthEmu(valAx);
		valueAxisOrientation = readAxisOrientation(valAx);
		valueAxisMajorTickMark = readTickMark(valAx);
		valueAxisMinorTickMark = readTickMarkLocal(valAx, "minorTickMark");
		const valPosEl = firstChildElement(valAx, qname("c", "tickLblPos", NS_C));
		if (valPosEl) {
			const v = getAttrValue(valPosEl, ATTR_VAL);
			if (v === "none" || v === "low" || v === "high" || v === "nextTo") valueAxisTickLabelPos = v;
		}
		const crossesAtEl = firstChildElement(valAx, qname("c", "crossesAt", NS_C));
		if (crossesAtEl) {
			const v = getAttrValue(crossesAtEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseFloat(v);
				if (Number.isFinite(n)) valueAxisCrosses = { at: n };
			}
		} else {
			const crossesEl = firstChildElement(valAx, qname("c", "crosses", NS_C));
			if (crossesEl) {
				const v = getAttrValue(crossesEl, ATTR_VAL);
				if (v === "autoZero" || v === "min" || v === "max") valueAxisCrosses = v;
			}
		}
		const crossBetweenEl = firstChildElement(valAx, qname("c", "crossBetween", NS_C));
		if (crossBetweenEl) {
			const v = getAttrValue(crossBetweenEl, ATTR_VAL);
			if (v === "between" || v === "midCat") valueAxisCrossBetween = v;
		}
		const majorGl = firstChildElement(valAx, qname("c", "majorGridlines", NS_C));
		valueAxisMajorGridlines = majorGl !== null;
		if (majorGl) {
			valueAxisMajorGridlineColor = readGridlineColor(majorGl);
			valueAxisMajorGridlineWidthEmu = readLineWidthEmu(majorGl);
		}
		const minorGl = firstChildElement(valAx, qname("c", "minorGridlines", NS_C));
		valueAxisMinorGridlines = minorGl !== null;
		if (minorGl) {
			valueAxisMinorGridlineColor = readGridlineColor(minorGl);
			valueAxisMinorGridlineWidthEmu = readLineWidthEmu(minorGl);
		}
	}
	let secondaryValueAxis;
	if (secValAx !== null) {
		const scaling = readValueAxisScaling(secValAx);
		const title = readTitle(secValAx);
		const titleEl = firstChildElement(secValAx, NAME_TITLE);
		const titleStyle = titleEl !== null ? readTitleStyleOf(titleEl) : void 0;
		const txPr = firstChildElement(secValAx, qname("c", "txPr", NS_C));
		const labelStyle = txPr !== null ? readLabelStyle(txPr) : void 0;
		const majorGl = firstChildElement(secValAx, qname("c", "majorGridlines", NS_C));
		const majorGridlineColor = majorGl !== null ? readGridlineColor(majorGl) : void 0;
		const majorGridlineWidthEmu = majorGl !== null ? readLineWidthEmu(majorGl) : void 0;
		const lineColor = readAxisLineColor(secValAx);
		const lineWidthEmu = readLineWidthEmu(secValAx);
		const majorTickMark = readTickMark(secValAx);
		const minorTickMark = readTickMarkLocal(secValAx, "minorTickMark");
		const secPosEl = firstChildElement(secValAx, qname("c", "tickLblPos", NS_C));
		const secPos = secPosEl !== null ? getAttrValue(secPosEl, ATTR_VAL) : null;
		const tickLabelPos = secPos === "none" || secPos === "low" || secPos === "high" || secPos === "nextTo" ? secPos : void 0;
		const crossBetweenEl = firstChildElement(secValAx, qname("c", "crossBetween", NS_C));
		const cb = crossBetweenEl !== null ? getAttrValue(crossBetweenEl, ATTR_VAL) : null;
		const crossBetween = cb === "between" || cb === "midCat" ? cb : void 0;
		const fields = {
			...scaling !== void 0 ? { scaling } : {},
			...title !== void 0 ? { title } : {},
			...titleStyle !== void 0 ? { titleStyle } : {},
			...labelStyle !== void 0 ? { labelStyle } : {},
			...majorGl !== null ? { majorGridlines: true } : {},
			...majorGridlineColor !== void 0 ? { majorGridlineColor } : {},
			...majorGridlineWidthEmu !== void 0 ? { majorGridlineWidthEmu } : {},
			...lineColor !== void 0 ? { lineColor } : {},
			...lineWidthEmu !== void 0 ? { lineWidthEmu } : {},
			...majorTickMark !== void 0 ? { majorTickMark } : {},
			...minorTickMark !== void 0 ? { minorTickMark } : {},
			...tickLabelPos !== void 0 ? { tickLabelPos } : {},
			...crossBetween !== void 0 ? { crossBetween } : {}
		};
		if (Object.keys(fields).length > 0) secondaryValueAxis = fields;
	}
	const readSpPrFill = (parent) => {
		const spPr = firstChildElement(parent, NAME_SP_PR_C);
		if (!spPr) return void 0;
		const solid = firstChildElement(spPr, NAME_SOLID_FILL$1);
		if (!solid) return void 0;
		const srgb = firstChildElement(solid, NAME_SRGB_CLR);
		if (!srgb) return void 0;
		const v = getAttrValue(srgb, ATTR_VAL);
		return v !== null ? `#${v.toUpperCase()}` : void 0;
	};
	const readSpPrStrokeColor = (parent) => {
		const spPr = firstChildElement(parent, NAME_SP_PR_C);
		if (!spPr) return void 0;
		const ln = firstChildElement(spPr, qname("a", "ln", NS_A));
		if (!ln) return void 0;
		const solid = firstChildElement(ln, NAME_SOLID_FILL$1);
		if (!solid) return void 0;
		const srgb = firstChildElement(solid, NAME_SRGB_CLR);
		if (!srgb) return void 0;
		const v = getAttrValue(srgb, ATTR_VAL);
		return v !== null ? `#${v.toUpperCase()}` : void 0;
	};
	const plotAreaFill = readSpPrFill(plotArea);
	const plotAreaStrokeColor = readSpPrStrokeColor(plotArea);
	const chartAreaFill = readSpPrFill(root);
	const chartAreaStrokeColor = readSpPrStrokeColor(root);
	let dispBlanksAs;
	const dbaEl = firstChildElement(chart, qname("c", "dispBlanksAs", NS_C));
	if (dbaEl) {
		const v = getAttrValue(dbaEl, ATTR_VAL);
		if (v === "gap" || v === "zero" || v === "span") dispBlanksAs = v;
	}
	let plotVisibleCellsOnly;
	const pvoEl = firstChildElement(chart, qname("c", "plotVisOnly", NS_C));
	if (pvoEl) {
		const v = getAttrValue(pvoEl, ATTR_VAL);
		if (v === "0" || v === "false") plotVisibleCellsOnly = false;
	}
	let roundedCorners;
	const rcEl = firstChildElement(root, qname("c", "roundedCorners", NS_C));
	if (rcEl) {
		const v = getAttrValue(rcEl, ATTR_VAL);
		if (v === "1" || v === "true") roundedCorners = true;
	}
	let chartStyle;
	const styleEl = firstChildElement(root, qname("c", "style", NS_C));
	if (styleEl) {
		const v = getAttrValue(styleEl, ATTR_VAL);
		if (v !== null) {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n) && n >= 1 && n <= 48) chartStyle = n;
		}
	}
	let language;
	const langEl = firstChildElement(root, qname("c", "lang", NS_C));
	if (langEl) {
		const v = getAttrValue(langEl, ATTR_VAL);
		if (v !== null && v.length > 0) language = v;
	}
	let date1904;
	const dateEl = firstChildElement(root, qname("c", "date1904", NS_C));
	if (dateEl) {
		const v = getAttrValue(dateEl, ATTR_VAL);
		if (v === "1" || v === "true") date1904 = true;
	}
	let legend;
	const legendEl = firstChildElement(chart, qname("c", "legend", NS_C));
	if (legendEl) {
		const posEl = firstChildElement(legendEl, qname("c", "legendPos", NS_C));
		const tok = posEl ? getAttrValue(posEl, ATTR_VAL) : null;
		const ovEl = firstChildElement(legendEl, qname("c", "overlay", NS_C));
		const overlay = ovEl ? getAttrValue(ovEl, ATTR_VAL) !== "0" : false;
		const txPr = firstChildElement(legendEl, qname("c", "txPr", NS_C));
		const textStyle = txPr ? readLabelStyle(txPr) : void 0;
		const hiddenIndices = [];
		for (const c of legendEl.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS_C || c.name.localName !== "legendEntry") continue;
			const idxEl = firstChildElement(c, qname("c", "idx", NS_C));
			const delEl = firstChildElement(c, qname("c", "delete", NS_C));
			if (!idxEl || !delEl) continue;
			const delV = getAttrValue(delEl, ATTR_VAL);
			if (!(delV === null || delV === "1" || delV === "true")) continue;
			const idxV = getAttrValue(idxEl, ATTR_VAL);
			if (idxV === null) continue;
			const n = Number.parseInt(idxV, 10);
			if (Number.isFinite(n) && n >= 0) hiddenIndices.push(n);
		}
		const position = tok === "r" || tok === "t" || tok === "b" || tok === "l" || tok === "tr" ? tok : "r";
		const legendLayout = readBoxLayout(legendEl);
		legend = {
			position,
			...overlay ? { overlay } : {},
			...legendLayout !== void 0 ? { layout: legendLayout } : {},
			...textStyle !== void 0 ? { textStyle } : {},
			...hiddenIndices.length > 0 ? { hiddenIndices } : {}
		};
	}
	let varyColors;
	const vcEl = firstChildElement(plotted, qname("c", "varyColors", NS_C));
	if (vcEl) {
		const v = getAttrValue(vcEl, ATTR_VAL);
		varyColors = v === null || v === "1" || v === "true";
	}
	let titleOverlay;
	const titleEl = firstChildElement(chart, NAME_TITLE);
	if (titleEl) {
		const ovEl = firstChildElement(titleEl, qname("c", "overlay", NS_C));
		if (ovEl) titleOverlay = getAttrValue(ovEl, ATTR_VAL) !== "0";
	}
	let firstSliceAngleDeg;
	let holeSizePct;
	if (kind === "pie" || kind === "doughnut") {
		const fsAng = firstChildElement(plotted, qname("c", "firstSliceAng", NS_C));
		if (fsAng) {
			const v = getAttrValue(fsAng, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n)) firstSliceAngleDeg = (n % 360 + 360) % 360;
			}
		}
		if (kind === "doughnut") {
			const hs = firstChildElement(plotted, qname("c", "holeSize", NS_C));
			if (hs) {
				const v = getAttrValue(hs, ATTR_VAL);
				if (v !== null) {
					const n = Number.parseInt(v, 10);
					if (Number.isFinite(n)) holeSizePct = Math.max(10, Math.min(90, n));
				}
			}
		}
	}
	let scatterStyle;
	let radarStyle;
	let bubbleScale;
	let bubbleSizeRepresents;
	if (kind === "scatter") {
		const el = firstChildElement(plotted, qname("c", "scatterStyle", NS_C));
		if (el) {
			const v = getAttrValue(el, ATTR_VAL);
			if (v === "none" || v === "line" || v === "lineMarker" || v === "marker" || v === "smooth" || v === "smoothMarker") scatterStyle = v;
		}
	} else if (kind === "radar") {
		const el = firstChildElement(plotted, qname("c", "radarStyle", NS_C));
		if (el) {
			const v = getAttrValue(el, ATTR_VAL);
			if (v === "standard" || v === "marker" || v === "filled") radarStyle = v;
		}
	} else if (kind === "bubble") {
		const bsEl = firstChildElement(plotted, qname("c", "bubbleScale", NS_C));
		if (bsEl) {
			const v = getAttrValue(bsEl, ATTR_VAL);
			if (v !== null) {
				const n = Number.parseInt(v, 10);
				if (Number.isFinite(n) && n >= 0) bubbleScale = Math.min(300, n);
			}
		}
		const srEl = firstChildElement(plotted, qname("c", "sizeRepresents", NS_C));
		if (srEl) {
			const v = getAttrValue(srEl, ATTR_VAL);
			if (v === "area") bubbleSizeRepresents = "area";
			else if (v === "w") bubbleSizeRepresents = "width";
		}
	}
	const plottedName = plotted.name.localName;
	const view3DEl = readView3D(chart);
	const view3D = plottedName.endsWith("3DChart") || kind === "surface" ? view3DEl : void 0;
	const bar3DShape = plottedName === "bar3DChart" ? childToken(plotted, "shape", [
		"box",
		"cone",
		"coneToMax",
		"cylinder",
		"pyramid",
		"pyramidToMax"
	]) : void 0;
	const gapDepthPct = view3D !== void 0 ? childNumber(plotted, "gapDepth") : void 0;
	const bubble3D = kind === "bubble" && allChildElements(plotted, NAME_SER).some((ser) => childBool(ser, "bubble3D") === true);
	const showNegativeBubbles = kind === "bubble" ? childBool(plotted, "showNegBubbles") : void 0;
	const ofPie = plottedName === "ofPieChart" ? readOfPie(plotted) : void 0;
	const surfaceContour = plottedName === "surfaceChart";
	const surfaceWireframe = kind === "surface" ? childBool(plotted, "wireframe") : void 0;
	const upDownBars = readUpDownBars(plotted);
	const dataTable = readDataTable(plotArea);
	const seriesAxis = readSeriesAxis(plotArea);
	const plotAreaLayout = readBoxLayout(plotArea);
	const chartTitleEl = firstChildElement(chart, NAME_TITLE);
	const titlePosition = chartTitleEl !== null ? readManualLayout(chartTitleEl) : void 0;
	const titleLayout = titlePosition !== void 0 ? {
		x: titlePosition.x,
		y: titlePosition.y
	} : void 0;
	const categoryAxisDate = catAx !== null && catAx.name.localName === "dateAx" ? readDateAxis(catAx) : void 0;
	const horizontalScaling = catAx !== null ? readValueAxisScaling(catAx) : void 0;
	const categoryAxisScaling = isXyKind ? withoutNumberFormat(horizontalScaling) : categoryAxisDate !== void 0 ? minMaxOnly(horizontalScaling) : void 0;
	const valueAxisLineHidden = valAx !== null && isAxisLineHidden(valAx);
	const categoryAxisLineHidden = catAx !== null && isAxisLineHidden(catAx);
	return {
		kind,
		categories,
		series,
		...title !== void 0 ? { title } : {},
		...titleStyle !== void 0 ? { titleStyle } : {},
		...dataLabels !== void 0 ? { dataLabels } : {},
		...valueAxis !== void 0 ? { valueAxis } : {},
		...secondaryValueAxis !== void 0 ? { secondaryValueAxis } : {},
		...grouping !== void 0 ? { grouping } : {},
		...dropLines !== void 0 ? { dropLines } : {},
		...hiLowLines !== void 0 ? { hiLowLines } : {},
		...lineMarkers !== void 0 ? { lineMarkers } : {},
		...gapWidthPct !== void 0 ? { gapWidthPct } : {},
		...overlapPct !== void 0 ? { overlapPct } : {},
		...legend !== void 0 ? { legend } : {},
		...titleOverlay !== void 0 ? { titleOverlay } : {},
		...varyColors !== void 0 ? { varyColors } : {},
		...dispBlanksAs !== void 0 ? { dispBlanksAs } : {},
		...plotVisibleCellsOnly === false ? { plotVisibleCellsOnly: false } : {},
		...roundedCorners === true ? { roundedCorners: true } : {},
		...chartStyle !== void 0 ? { chartStyle } : {},
		...language !== void 0 ? { language } : {},
		...date1904 === true ? { date1904: true } : {},
		...plotAreaFill !== void 0 ? { plotAreaFill } : {},
		...plotAreaStrokeColor !== void 0 ? { plotAreaStrokeColor } : {},
		...chartAreaFill !== void 0 ? { chartAreaFill } : {},
		...chartAreaStrokeColor !== void 0 ? { chartAreaStrokeColor } : {},
		...categoryAxisTitle !== void 0 ? { categoryAxisTitle } : {},
		...categoryAxisTitleStyle !== void 0 ? { categoryAxisTitleStyle } : {},
		...categoryAxisTitleRotationDeg !== void 0 ? { categoryAxisTitleRotationDeg } : {},
		...categoryAxisLabelStyle !== void 0 ? { categoryAxisLabelStyle } : {},
		...categoryAxisLabelRotationDeg !== void 0 ? { categoryAxisLabelRotationDeg } : {},
		...valueAxisTitle !== void 0 ? { valueAxisTitle } : {},
		...valueAxisTitleStyle !== void 0 ? { valueAxisTitleStyle } : {},
		...valueAxisTitleRotationDeg !== void 0 ? { valueAxisTitleRotationDeg } : {},
		...valueAxisLabelStyle !== void 0 ? { valueAxisLabelStyle } : {},
		...categoryAxisHidden !== void 0 ? { categoryAxisHidden } : {},
		...valueAxisHidden !== void 0 ? { valueAxisHidden } : {},
		...valueAxisMajorGridlines !== void 0 ? { valueAxisMajorGridlines } : {},
		...valueAxisMajorGridlineColor !== void 0 ? { valueAxisMajorGridlineColor } : {},
		...valueAxisMajorGridlineWidthEmu !== void 0 ? { valueAxisMajorGridlineWidthEmu } : {},
		...valueAxisMajorTickMark !== void 0 ? { valueAxisMajorTickMark } : {},
		...valueAxisMinorTickMark !== void 0 ? { valueAxisMinorTickMark } : {},
		...valueAxisTickLabelPos !== void 0 ? { valueAxisTickLabelPos } : {},
		...valueAxisLabelRotationDeg !== void 0 ? { valueAxisLabelRotationDeg } : {},
		...categoryAxisMajorTickMark !== void 0 ? { categoryAxisMajorTickMark } : {},
		...categoryAxisMinorTickMark !== void 0 ? { categoryAxisMinorTickMark } : {},
		...valueAxisMinorGridlines !== void 0 ? { valueAxisMinorGridlines } : {},
		...categoryAxisTickLabelSkip !== void 0 ? { categoryAxisTickLabelSkip } : {},
		...categoryAxisTickMarkSkip !== void 0 ? { categoryAxisTickMarkSkip } : {},
		...categoryAxisTickLabelPos !== void 0 ? { categoryAxisTickLabelPos } : {},
		...categoryAxisLabelOffset !== void 0 ? { categoryAxisLabelOffset } : {},
		...categoryAxisLabelAlign !== void 0 ? { categoryAxisLabelAlign } : {},
		...categoryAxisNumberFormat !== void 0 ? { categoryAxisNumberFormat } : {},
		...categoryAxisNoMultiLevelLabel === true ? { categoryAxisNoMultiLevelLabel: true } : {},
		...categoryAxisLineColor !== void 0 ? { categoryAxisLineColor } : {},
		...valueAxisLineColor !== void 0 ? { valueAxisLineColor } : {},
		...categoryAxisMajorGridlines === true ? { categoryAxisMajorGridlines: true } : {},
		...categoryAxisMinorGridlines === true ? { categoryAxisMinorGridlines: true } : {},
		...categoryAxisMajorGridlineColor !== void 0 ? { categoryAxisMajorGridlineColor } : {},
		...categoryAxisMinorGridlineColor !== void 0 ? { categoryAxisMinorGridlineColor } : {},
		...valueAxisMinorGridlineColor !== void 0 ? { valueAxisMinorGridlineColor } : {},
		...categoryAxisLineWidthEmu !== void 0 ? { categoryAxisLineWidthEmu } : {},
		...valueAxisLineWidthEmu !== void 0 ? { valueAxisLineWidthEmu } : {},
		...categoryAxisMajorGridlineWidthEmu !== void 0 ? { categoryAxisMajorGridlineWidthEmu } : {},
		...categoryAxisMinorGridlineWidthEmu !== void 0 ? { categoryAxisMinorGridlineWidthEmu } : {},
		...valueAxisMinorGridlineWidthEmu !== void 0 ? { valueAxisMinorGridlineWidthEmu } : {},
		...categoryAxisOrientation !== void 0 ? { categoryAxisOrientation } : {},
		...valueAxisOrientation !== void 0 ? { valueAxisOrientation } : {},
		...valueAxisCrosses !== void 0 ? { valueAxisCrosses } : {},
		...valueAxisCrossBetween !== void 0 ? { valueAxisCrossBetween } : {},
		...firstSliceAngleDeg !== void 0 ? { firstSliceAngleDeg } : {},
		...holeSizePct !== void 0 ? { holeSizePct } : {},
		...scatterStyle !== void 0 ? { scatterStyle } : {},
		...radarStyle !== void 0 ? { radarStyle } : {},
		...bubbleScale !== void 0 ? { bubbleScale } : {},
		...bubbleSizeRepresents !== void 0 ? { bubbleSizeRepresents } : {},
		...bubble3D === true ? { bubble3D } : {},
		...showNegativeBubbles !== void 0 ? { showNegativeBubbles } : {},
		...view3D !== void 0 ? { view3D } : {},
		...bar3DShape !== void 0 ? { bar3DShape } : {},
		...gapDepthPct !== void 0 ? { gapDepthPct } : {},
		...seriesAxis !== void 0 ? { seriesAxis } : {},
		...ofPie !== void 0 ? { ofPie } : {},
		...surfaceContour ? { surfaceContour } : {},
		...surfaceWireframe !== void 0 ? { surfaceWireframe } : {},
		...upDownBars !== void 0 ? { upDownBars } : {},
		...dataTable !== void 0 ? { dataTable } : {},
		...categoryAxisDate !== void 0 ? { categoryAxisDate } : {},
		...categoryAxisScaling !== void 0 ? { categoryAxisScaling } : {},
		...categoryGroupLevels !== void 0 ? { categoryGroupLevels } : {},
		...plotAreaLayout !== void 0 ? { plotAreaLayout } : {},
		...titleLayout !== void 0 ? { titleLayout } : {},
		...valueAxisLineHidden ? { valueAxisLineHidden } : {},
		...categoryAxisLineHidden ? { categoryAxisLineHidden } : {}
	};
};
//#endregion
//#region src/api/fn/slide-background.ts
const setSlideBackgroundXml = (slide, configure) => {
	const cSld = firstChildElement(slide[SLIDE_DOCUMENT].root, NAME_CSLD);
	if (!cSld) throw new Error("slide has no <p:cSld>");
	const bgName = qname("p", "bg", NS.pml);
	const bgPrName = qname("p", "bgPr", NS.pml);
	let bg = firstChildElement(cSld, bgName);
	if (bg === null) {
		bg = {
			kind: "element",
			name: bgName,
			attrs: [],
			prefixDecls: /* @__PURE__ */ new Map(),
			children: []
		};
		cSld.children.unshift(bg);
	}
	bg.children = [];
	const bgPr = {
		kind: "element",
		name: bgPrName,
		attrs: [],
		prefixDecls: /* @__PURE__ */ new Map(),
		children: []
	};
	bg.children.push(bgPr);
	configure(bgPr);
	commitSlideData(slide);
	refreshSlideData(slide);
};
/**
* Reads the slide's color-map override (`<p:clrMapOvr><p:overrideClrMapping/>`).
* The mapping remaps the eight stable ECMA-376 color tokens (`bg1`,
* `tx1`, `bg2`, `tx2`, `accent1`–`accent6`, `hlink`, `folHlink`) to
* different theme positions. Returns `null` when the slide uses the
* master's color map unchanged (the overwhelming common case).
*/
const getSlideColorMapOverride = (slide) => {
	const root = slide[SLIDE_DOCUMENT].root;
	let ovr = null;
	for (const c of root.children) {
		if (c.kind !== "element") continue;
		if (c.name.namespaceURI === NS.pml && c.name.localName === "clrMapOvr") {
			ovr = c;
			break;
		}
	}
	if (!ovr) return null;
	const mapping = firstChildElement(ovr, qname("a", "overrideClrMapping", NS.dml));
	if (!mapping) return null;
	const out = {};
	for (const a of mapping.attrs) {
		if (a.name.namespaceURI !== "") continue;
		out[a.name.localName] = a.value;
	}
	return Object.keys(out).length > 0 ? out : null;
};
const getSlideBackground = (slide) => {
	const cSld = firstChildElement(slide[SLIDE_DOCUMENT].root, NAME_CSLD);
	if (!cSld) return { kind: "inherit" };
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return { kind: "inherit" };
	const bgRef = firstChildElement(bg, qname("p", "bgRef", NS.pml));
	if (bgRef) {
		for (const inner of bgRef.children) {
			if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
			if (inner.name.localName === "srgbClr") {
				const val = getAttrValue(inner, qname("", "val", ""));
				if (val !== null) return {
					kind: "solid",
					color: `#${val.toUpperCase()}`
				};
			}
			if (inner.name.localName === "schemeClr") {
				const val = getAttrValue(inner, qname("", "val", ""));
				if (val !== null) return {
					kind: "solid",
					color: `scheme:${val}`
				};
			}
		}
		return { kind: "inherit" };
	}
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return { kind: "inherit" };
	for (const c of bgPr.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		switch (c.name.localName) {
			case "solidFill":
				for (const inner of c.children) {
					if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
					if (inner.name.localName === "srgbClr") {
						const val = getAttrValue(inner, qname("", "val", ""));
						if (val !== null) return {
							kind: "solid",
							color: `#${val.toUpperCase()}`
						};
					}
					if (inner.name.localName === "schemeClr") {
						const val = getAttrValue(inner, qname("", "val", ""));
						if (val !== null) return {
							kind: "solid",
							color: `scheme:${val}`
						};
					}
				}
				return {
					kind: "solid",
					color: ""
				};
			case "gradFill": return { kind: "gradient" };
			case "pattFill": return { kind: "pattern" };
			case "blipFill": return { kind: "image" };
		}
	}
	return { kind: "inherit" };
};
/**
* Returns the non-placeholder shapes on a layout as a render-ready
* view. Useful for previewing brand-template decoration (corner bars,
* background rectangles, divider lines) that would otherwise be hidden
* because they aren't reachable through `getSlideLayoutPlaceholders`.
*
* Placeholders are excluded — they're better rendered through the
* slide's own placeholder bounds (which already cascade through the
* layout). Picture and group shapes are omitted; their bytes / nested
* children would need the layout's relationship table to resolve.
*/
const getSlideLayoutBackgroundShapes = (pres, layout) => {
	const theme = getPresentationTheme(pres);
	const out = [];
	for (const shape of layout[LAYOUT_PART].shapes) {
		if (shape.placeholderType !== null || shape.placeholderIdx !== null) continue;
		if (shape.kind !== "shape" && shape.kind !== "connector") continue;
		const el = shape.element;
		const pos = readPosition(el, shape.kind);
		const size = readSize(el, shape.kind);
		const bounds = pos !== null && size !== null ? {
			x: pos.x,
			y: pos.y,
			w: size.w,
			h: size.h
		} : null;
		const spPr = firstChildElement(el, qname("p", "spPr", NS.pml));
		let preset = null;
		let fillHex = null;
		let strokeHex = null;
		let strokeWidthEmu = null;
		if (spPr) {
			const prstGeom = firstChildElement(spPr, qname("a", "prstGeom", NS.dml));
			if (prstGeom) preset = getAttrValue(prstGeom, qname("", "prst", ""));
			const solid = firstChildElement(spPr, qname("a", "solidFill", NS.dml));
			if (solid) for (const c of solid.children) {
				if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
				fillHex = resolveDrawingColor(c, theme);
				break;
			}
			const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
			if (ln) {
				const w = getAttrValue(ln, qname("", "w", ""));
				if (w !== null) {
					const n = Number.parseInt(w, 10);
					if (Number.isFinite(n)) strokeWidthEmu = n;
				}
				const lnSolid = firstChildElement(ln, qname("a", "solidFill", NS.dml));
				if (lnSolid) for (const c of lnSolid.children) {
					if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
					strokeHex = resolveDrawingColor(c, theme);
					break;
				}
			}
		}
		const rotation = readRotation(el, shape.kind);
		const flip = readFlip(el, shape.kind) ?? {
			horizontal: false,
			vertical: false
		};
		out.push({
			kind: shape.kind,
			bounds,
			preset,
			fillHex,
			strokeHex,
			strokeWidthEmu,
			rotation,
			flip
		});
	}
	return out;
};
const partDecorationShapes = (pkg, thePartName, csldType) => {
	const part = pkg.getPart(thePartName);
	if (part === null) return [];
	const doc = parseXml(decode$1(part.data));
	const { shapes } = readShapeTreeFromCsldRoot(doc.root, csldType);
	const data = {
		[INTERNAL_PACKAGE]: pkg,
		[SLIDE_PART_NAME]: thePartName,
		[SLIDE_DOCUMENT]: doc,
		[SLIDE_PART]: {
			shapes,
			root: doc.root
		},
		[SLIDE_SHAPES]: []
	};
	data[SLIDE_SHAPES] = shapes.filter((s) => s.placeholderType === null && s.placeholderIdx === null).map((snap) => ({
		[SHAPE_SLIDE]: data,
		[SHAPE_ELEMENT]: snap.element,
		[SHAPE_SNAPSHOT]: snap
	}));
	return data[SLIDE_SHAPES];
};
/**
* Non-placeholder decorative shapes on a slide layout — corner bars, divider
* lines, **logos**, watermark text — as full `SlideShapeData` bound to the
* layout part. Unlike `getSlideLayoutBackgroundShapes` (a flat summary that
* drops pictures and groups), these work with every `getShape*` reader, so a
* renderer can paint them with real geometry, fills, text and picture bytes.
*
* For reading / rendering only — the handles are bound to the layout part, not
* a slide, so the mutating `setShape*` helpers should not be used on them.
*/
const getSlideLayoutShapes = (pres, layout) => partDecorationShapes(pres[INTERNAL_PACKAGE], layout[LAYOUT_PART_NAME], "sldLayout");
/**
* Non-placeholder decorative shapes on the layout's slide master — the
* template decoration shared by every layout (background logos, divider lines,
* etc.). Same render-ready `SlideShapeData` view as `getSlideLayoutShapes`.
*/
const getSlideMasterShapes = (pres, layout) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutName = layout[LAYOUT_PART_NAME];
	const masterRel = pkg.getRels(layoutName)?.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return [];
	return partDecorationShapes(pkg, masterRel.target.startsWith("/") ? partName(masterRel.target) : resolveTarget(layoutName, masterRel.target), "sldMaster");
};
/**
* Reads the slide layout's background. Same discriminated union as
* `getSlideBackground` for slides — renderers fall back to this when
* the slide's own background reports `'inherit'`. Walking one further
* level to the master is left to callers (the same shape applies).
*/
/**
* Reads the slide layout's pattern background when its `<p:bg>` is a
* `<p:bgPr><a:pattFill>`. Same shape as `getSlideBackgroundPatternFill`
* for slides.
*/
const getSlideLayoutBackgroundPatternFill = (pres, layout) => {
	const cSld = firstChildElement(layout[LAYOUT_PART].root, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const pattFill = firstChildElement(bgPr, qname("a", "pattFill", NS.dml));
	if (!pattFill) return null;
	const preset = getAttrValue(pattFill, qname("", "prst", "")) ?? "pct50";
	const theme = getPresentationTheme(pres);
	const colorFrom = (parentName, fallback) => {
		const parent = firstChildElement(pattFill, qname("a", parentName, NS.dml));
		if (!parent) return fallback;
		for (const c of parent.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			const hex = resolveDrawingColor(c, theme);
			if (hex) return hex;
		}
		return fallback;
	};
	return {
		preset,
		foreground: colorFrom("fgClr", "#000000"),
		background: colorFrom("bgClr", "#FFFFFF")
	};
};
/**
* Reads the slide master's pattern background. Companion to
* `getSlideLayoutBackgroundPatternFill`.
*/
const getSlideMasterBackgroundPatternFill = (pres, layout) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return null;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return null;
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return null;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const cSld = firstChildElement(masterRoot, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const pattFill = firstChildElement(bgPr, qname("a", "pattFill", NS.dml));
	if (!pattFill) return null;
	const preset = getAttrValue(pattFill, qname("", "prst", "")) ?? "pct50";
	const theme = getPresentationTheme(pres);
	const colorFrom = (parentName, fallback) => {
		const parent = firstChildElement(pattFill, qname("a", parentName, NS.dml));
		if (!parent) return fallback;
		for (const c of parent.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			const hex = resolveDrawingColor(c, theme);
			if (hex) return hex;
		}
		return fallback;
	};
	return {
		preset,
		foreground: colorFrom("fgClr", "#000000"),
		background: colorFrom("bgClr", "#FFFFFF")
	};
};
/**
* Reads the slide layout's gradient background when its `<p:bg>` is a
* `<p:bgPr><a:gradFill>`. Same shape as `getSlideBackgroundGradientFill`
* for slides.
*/
const getSlideLayoutBackgroundGradientFill = (layout) => {
	const cSld = firstChildElement(layout[LAYOUT_PART].root, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const gradFill = firstChildElement(bgPr, NAME_A_GRAD_FILL);
	if (!gradFill) return null;
	const gsLst = firstChildElement(gradFill, NAME_A_GS_LST);
	if (!gsLst) return null;
	const stops = [];
	for (const c of gsLst.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml || c.name.localName !== "gs") continue;
		const posRaw = getAttrValue(c, qname("", "pos", ""));
		if (posRaw === null) continue;
		const pos = Number.parseInt(posRaw, 10);
		if (!Number.isFinite(pos)) continue;
		const color = readColorFromContainer(c);
		if (color === null) continue;
		stops.push({
			offset: pos / 1e5,
			color
		});
	}
	if (stops.length === 0) return null;
	let angleDeg = 0;
	const lin = firstChildElement(gradFill, NAME_A_LIN);
	if (lin) {
		const angRaw = getAttrValue(lin, qname("", "ang", ""));
		if (angRaw !== null) {
			const ang = Number.parseInt(angRaw, 10);
			if (Number.isFinite(ang)) angleDeg = ang / 6e4;
		}
	}
	const pathEl = firstChildElement(gradFill, qname("a", "path", NS.dml));
	if (pathEl) {
		const p = getAttrValue(pathEl, qname("", "path", ""));
		const pathVal = p === "circle" || p === "rect" || p === "shape" ? p : null;
		if (pathVal) return {
			stops,
			angleDeg,
			path: pathVal
		};
	}
	return {
		stops,
		angleDeg
	};
};
/**
* Reads the slide master's gradient background when present. Mirrors
* `getSlideLayoutBackgroundGradientFill`; returns `null` for any other
* background kind. Useful for closing the bg cascade — slides that
* report `'gradient'` inherit can now get the master's gradient
* projected via `gradientDef`.
*/
const getSlideMasterBackgroundGradientFill = (pres, layout) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return null;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return null;
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return null;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const cSld = firstChildElement(masterRoot, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const gradFill = firstChildElement(bgPr, NAME_A_GRAD_FILL);
	if (!gradFill) return null;
	const gsLst = firstChildElement(gradFill, NAME_A_GS_LST);
	if (!gsLst) return null;
	const stops = [];
	for (const c of gsLst.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml || c.name.localName !== "gs") continue;
		const posRaw = getAttrValue(c, qname("", "pos", ""));
		if (posRaw === null) continue;
		const pos = Number.parseInt(posRaw, 10);
		if (!Number.isFinite(pos)) continue;
		const color = readColorFromContainer(c);
		if (color === null) continue;
		stops.push({
			offset: pos / 1e5,
			color
		});
	}
	if (stops.length === 0) return null;
	let angleDeg = 0;
	const lin = firstChildElement(gradFill, NAME_A_LIN);
	if (lin) {
		const angRaw = getAttrValue(lin, qname("", "ang", ""));
		if (angRaw !== null) {
			const ang = Number.parseInt(angRaw, 10);
			if (Number.isFinite(ang)) angleDeg = ang / 6e4;
		}
	}
	const pathEl = firstChildElement(gradFill, qname("a", "path", NS.dml));
	if (pathEl) {
		const p = getAttrValue(pathEl, qname("", "path", ""));
		const pathVal = p === "circle" || p === "rect" || p === "shape" ? p : null;
		if (pathVal) return {
			stops,
			angleDeg,
			path: pathVal
		};
	}
	return {
		stops,
		angleDeg
	};
};
/**
* Reads the slide master's background. Same discriminated union as
* `getSlideBackground` / `getSlideLayoutBackground`. Walks one rel up
* from the layout to find the master, then reads `<p:bg>` (either
* `<p:bgPr>` explicit fill or `<p:bgRef>` theme reference).
*
* Slides that report `'inherit'` on both their own background and the
* layout's commonly inherit the brand fill from the master — this
* closes the third level of the cascade.
*/
const getSlideMasterBackground = (pres, layout) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return { kind: "inherit" };
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return { kind: "inherit" };
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return { kind: "inherit" };
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const cSld = firstChildElement(masterRoot, NAME_CSLD);
	if (!cSld) return { kind: "inherit" };
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return { kind: "inherit" };
	const bgRef = firstChildElement(bg, qname("p", "bgRef", NS.pml));
	if (bgRef) {
		for (const inner of bgRef.children) {
			if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
			if (inner.name.localName === "srgbClr") {
				const val = getAttrValue(inner, qname("", "val", ""));
				if (val !== null) return {
					kind: "solid",
					color: `#${val.toUpperCase()}`
				};
			}
			if (inner.name.localName === "schemeClr") {
				const val = getAttrValue(inner, qname("", "val", ""));
				if (val !== null) return {
					kind: "solid",
					color: `scheme:${val}`
				};
			}
		}
		return { kind: "inherit" };
	}
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return { kind: "inherit" };
	for (const c of bgPr.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		switch (c.name.localName) {
			case "solidFill":
				for (const inner of c.children) {
					if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
					if (inner.name.localName === "srgbClr") {
						const val = getAttrValue(inner, qname("", "val", ""));
						if (val !== null) return {
							kind: "solid",
							color: `#${val.toUpperCase()}`
						};
					}
					if (inner.name.localName === "schemeClr") {
						const val = getAttrValue(inner, qname("", "val", ""));
						if (val !== null) return {
							kind: "solid",
							color: `scheme:${val}`
						};
					}
				}
				return {
					kind: "solid",
					color: ""
				};
			case "gradFill": return { kind: "gradient" };
			case "pattFill": return { kind: "pattern" };
			case "blipFill": return { kind: "image" };
		}
	}
	return { kind: "inherit" };
};
const getSlideLayoutBackground = (layout) => {
	const cSld = firstChildElement(layout[LAYOUT_PART].root, NAME_CSLD);
	if (!cSld) return { kind: "inherit" };
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return { kind: "inherit" };
	const bgRef = firstChildElement(bg, qname("p", "bgRef", NS.pml));
	if (bgRef) {
		for (const inner of bgRef.children) {
			if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
			if (inner.name.localName === "srgbClr") {
				const val = getAttrValue(inner, qname("", "val", ""));
				if (val !== null) return {
					kind: "solid",
					color: `#${val.toUpperCase()}`
				};
			}
			if (inner.name.localName === "schemeClr") {
				const val = getAttrValue(inner, qname("", "val", ""));
				if (val !== null) return {
					kind: "solid",
					color: `scheme:${val}`
				};
			}
		}
		return { kind: "inherit" };
	}
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return { kind: "inherit" };
	for (const c of bgPr.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		switch (c.name.localName) {
			case "solidFill":
				for (const inner of c.children) {
					if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
					if (inner.name.localName === "srgbClr") {
						const val = getAttrValue(inner, qname("", "val", ""));
						if (val !== null) return {
							kind: "solid",
							color: `#${val.toUpperCase()}`
						};
					}
					if (inner.name.localName === "schemeClr") {
						const val = getAttrValue(inner, qname("", "val", ""));
						if (val !== null) return {
							kind: "solid",
							color: `scheme:${val}`
						};
					}
				}
				return {
					kind: "solid",
					color: ""
				};
			case "gradFill": return { kind: "gradient" };
			case "pattFill": return { kind: "pattern" };
			case "blipFill": return { kind: "image" };
		}
	}
	return { kind: "inherit" };
};
/**
* Returns the gradient stops + path when the slide carries a
* `<p:bgPr><a:gradFill>` background. Returns `null` for any other
* background kind. Shape identical to `getShapeGradientFill` so renderers
* can use the same projection logic for slide backgrounds.
*/
const getSlideBackgroundGradientFill = (slide) => {
	const cSld = firstChildElement(slide[SLIDE_DOCUMENT].root, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const gradFill = firstChildElement(bgPr, NAME_A_GRAD_FILL);
	if (!gradFill) return null;
	const gsLst = firstChildElement(gradFill, NAME_A_GS_LST);
	if (!gsLst) return null;
	const stops = [];
	for (const c of gsLst.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml || c.name.localName !== "gs") continue;
		const posRaw = getAttrValue(c, qname("", "pos", ""));
		if (posRaw === null) continue;
		const pos = Number.parseInt(posRaw, 10);
		if (!Number.isFinite(pos)) continue;
		const color = readColorFromContainer(c);
		if (color === null) continue;
		stops.push({
			offset: pos / 1e5,
			color
		});
	}
	if (stops.length === 0) return null;
	let angleDeg = 0;
	const lin = firstChildElement(gradFill, NAME_A_LIN);
	if (lin) {
		const angRaw = getAttrValue(lin, qname("", "ang", ""));
		if (angRaw !== null) {
			const ang = Number.parseInt(angRaw, 10);
			if (Number.isFinite(ang)) angleDeg = ang / 6e4;
		}
	}
	const pathEl = firstChildElement(gradFill, qname("a", "path", NS.dml));
	if (pathEl) {
		const p = getAttrValue(pathEl, qname("", "path", ""));
		const pathVal = p === "circle" || p === "rect" || p === "shape" ? p : null;
		if (pathVal) return {
			stops,
			angleDeg,
			path: pathVal
		};
	}
	return {
		stops,
		angleDeg
	};
};
/**
* Returns the pattern preset + theme-resolved colors when the slide
* carries a `<p:bgPr><a:pattFill>` background. Returns `null` for any
* other background kind. Shape mirrors `getShapePatternFill`.
*/
const getSlideBackgroundPatternFill = (pres, slide) => {
	const cSld = firstChildElement(slide[SLIDE_DOCUMENT].root, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const pattFill = firstChildElement(bgPr, qname("a", "pattFill", NS.dml));
	if (!pattFill) return null;
	const preset = getAttrValue(pattFill, qname("", "prst", "")) ?? "pct50";
	const theme = getPresentationTheme(pres);
	const colorFrom = (parentName, fallback) => {
		const parent = firstChildElement(pattFill, qname("a", parentName, NS.dml));
		if (!parent) return fallback;
		for (const c of parent.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			const hex = resolveDrawingColor(c, theme);
			if (hex) return hex;
		}
		return fallback;
	};
	return {
		preset,
		foreground: colorFrom("fgClr", "#000000"),
		background: colorFrom("bgClr", "#FFFFFF")
	};
};
/**
* Returns the embedded image bytes when the slide carries a
* `<p:bgPr><a:blipFill>` background, or `null` for any other background
* kind (solid / gradient / pattern / inherit) or when the `r:embed`
* relationship points at an external `r:link` target.
*
* Companion to `getSlideBackground`, which only reports the
* discriminated `kind`. Renderers that want to actually paint the
* background image (preview generators, snapshot tools) call this.
*/
const getSlideBackgroundImageBytes = (slide) => {
	const cSld = firstChildElement(slide[SLIDE_DOCUMENT].root, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const blipFill = firstChildElement(bgPr, qname("a", "blipFill", NS.dml));
	if (!blipFill) return null;
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) return null;
	const rEmbed = getAttrValue(blip, qname("r", "embed", NS.officeDocRels));
	if (rEmbed === null) return null;
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	const rel = rels.items.find((r) => r.id === rEmbed);
	if (!rel || rel.targetMode === "External") return null;
	const mediaName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
	return pkg.getPart(mediaName)?.data ?? null;
};
/**
* Reads the slide layout's background image bytes when its `<p:bg>` is
* a `<p:bgPr><a:blipFill>`. Same shape as `getSlideBackgroundImageBytes`
* for slides. Returns `null` when the layout has no image background.
*/
const getSlideLayoutBackgroundImageBytes = (pres, layout) => {
	const cSld = firstChildElement(layout[LAYOUT_PART].root, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const blipFill = firstChildElement(bgPr, qname("a", "blipFill", NS.dml));
	if (!blipFill) return null;
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) return null;
	const rEmbed = getAttrValue(blip, qname("r", "embed", NS.officeDocRels));
	if (rEmbed === null) return null;
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const rels = pkg.getRels(layoutPartName);
	if (!rels) return null;
	const rel = rels.items.find((r) => r.id === rEmbed);
	if (!rel || rel.targetMode === "External") return null;
	const mediaName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(layoutPartName, rel.target);
	return pkg.getPart(mediaName)?.data ?? null;
};
/**
* Reads the slide master's background image bytes (via the layout's
* master rel). Companion to `getSlideLayoutBackgroundImageBytes`.
*/
const getSlideMasterBackgroundImageBytes = (pres, layout) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return null;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return null;
	const masterPartName = resolveTarget(layoutPartName, masterRel.target);
	const masterPart = pkg.getPart(masterPartName);
	if (!masterPart) return null;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const cSld = firstChildElement(masterRoot, NAME_CSLD);
	if (!cSld) return null;
	const bg = firstChildElement(cSld, qname("p", "bg", NS.pml));
	if (!bg) return null;
	const bgPr = firstChildElement(bg, qname("p", "bgPr", NS.pml));
	if (!bgPr) return null;
	const blipFill = firstChildElement(bgPr, qname("a", "blipFill", NS.dml));
	if (!blipFill) return null;
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) return null;
	const rEmbed = getAttrValue(blip, qname("r", "embed", NS.officeDocRels));
	if (rEmbed === null) return null;
	const masterRels = pkg.getRels(masterPartName);
	if (!masterRels) return null;
	const rel = masterRels.items.find((r) => r.id === rEmbed);
	if (!rel || rel.targetMode === "External") return null;
	const mediaName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(masterPartName, rel.target);
	return pkg.getPart(mediaName)?.data ?? null;
};
/** Sets a solid fill on the slide's background. */
const setSlideBackground = (slide, color) => {
	setSlideBackgroundXml(slide, (bgPr) => setSolidFill(bgPr, color));
};
/**
* Sets a picture as the slide's background. Embeds `bytes` as a new
* media part, wires a slide → image rel, and replaces any prior
* background with a `<p:bgPr><a:blipFill><a:blip r:embed="…"/>
* <a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr>` payload.
*
* Format is detected from magic bytes; pass `options.format` to
* override.
*/
const setSlideBackgroundImage = (slide, bytes, options = {}) => {
	const format = options.format ?? detectImageFormat(bytes);
	if (format === null) throw new Error("setSlideBackgroundImage: could not detect image format. Pass options.format explicitly.");
	const contentType = contentTypeForFormat(format);
	const extension = extensionForFormat(format);
	const pkg = slide[INTERNAL_PACKAGE];
	let nextN = 1;
	const mediaPattern = /^\/ppt\/media\/image(\d+)\./;
	for (const p of pkg.parts) {
		const m = p.name.match(mediaPattern);
		if (m?.[1] !== void 0) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n) && n >= nextN) nextN = n + 1;
		}
	}
	const newMediaName = partName(`/ppt/media/image${nextN}.${extension}`);
	setOpcDefault(pkg, extension, contentType);
	pkg.addPart(newMediaName, contentType, bytes);
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
	const newRId = nextRelId(rels.items.map((r) => r.id));
	rels.items.push({
		id: newRId,
		type: REL_TYPES.image,
		target: `../media/image${nextN}.${extension}`,
		targetMode: "Internal"
	});
	pkg.setRels(slide[SLIDE_PART_NAME], rels);
	setSlideBackgroundXml(slide, (bgPr) => {
		const blip = elem(qname("a", "blip", NS.dml), { attrs: [attr(qname("r", "embed", NS.officeDocRels), newRId)] });
		const stretch = elem(qname("a", "stretch", NS.dml), { children: [elem(qname("a", "fillRect", NS.dml))] });
		bgPr.children.push(elem(qname("a", "blipFill", NS.dml), { children: [blip, stretch] }));
	});
};
/** Clears any explicit slide background, restoring layout inheritance. */
const clearSlideBackground = (slide) => {
	const cSld = firstChildElement(slide[SLIDE_DOCUMENT].root, NAME_CSLD);
	if (!cSld) return;
	cSld.children = cSld.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "bg"));
	commitSlideData(slide);
	refreshSlideData(slide);
};
//#endregion
//#region src/api/fn/color-map.ts
const STANDARD_COLOR_MAP = {
	bg1: "lt1",
	tx1: "dk1",
	bg2: "lt2",
	tx2: "dk2",
	accent1: "accent1",
	accent2: "accent2",
	accent3: "accent3",
	accent4: "accent4",
	accent5: "accent5",
	accent6: "accent6",
	hlink: "hlink",
	folHlink: "folHlink"
};
const NAME_CLR_MAP = qname("p", "clrMap", NS.pml);
const NAME_TX_STYLES = qname("p", "txStyles", NS.pml);
const NAME_BODY_STYLE = qname("p", "bodyStyle", NS.pml);
const NAME_LVL1_PPR = qname("a", "lvl1pPr", NS.dml);
const NAME_DEF_RPR = qname("a", "defRPr", NS.dml);
const NAME_SOLID_FILL = qname("a", "solidFill", NS.dml);
const getSlideMasterRoot = (slide) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const slideRels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (slideRels === null) return null;
	const layoutRel = slideRels.items.find((r) => r.type === REL_TYPES.slideLayout);
	if (!layoutRel) return null;
	const layoutPartName = layoutRel.target.startsWith("/") ? partName(layoutRel.target) : resolveTarget(slide[SLIDE_PART_NAME], layoutRel.target);
	const layoutRels = pkg.getRels(layoutPartName);
	if (layoutRels === null) return null;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return null;
	const masterPartName = masterRel.target.startsWith("/") ? partName(masterRel.target) : resolveTarget(layoutPartName, masterRel.target);
	const masterPart = pkg.getPart(masterPartName);
	if (masterPart === null) return null;
	return parseXml(decode$1(masterPart.data)).root;
};
const readClrMapElement = (root) => {
	const clrMap = firstChildElement(root, NAME_CLR_MAP);
	if (!clrMap) return null;
	const out = {};
	for (const a of clrMap.attrs) {
		if (a.name.namespaceURI !== "") continue;
		out[a.name.localName] = a.value;
	}
	return Object.keys(out).length > 0 ? out : null;
};
/**
* The slide's effective color map: the master's `<p:clrMap>`, overlaid by a
* per-slide `<p:clrMapOvr><a:overrideClrMapping>` when present. Falls back to
* the standard map for decks that omit it.
*
* Pass the result to color resolution / renderers so `schemeClr` tokens map to
* the theme slot PowerPoint actually paints — critical for decks with an
* inverted map (`bg1="dk1" tx1="lt1"`).
*/
const getEffectiveColorMap = (slide) => {
	const override = getSlideColorMapOverride(slide);
	if (override) return {
		...STANDARD_COLOR_MAP,
		...override
	};
	const masterRoot = getSlideMasterRoot(slide);
	const masterMap = masterRoot ? readClrMapElement(masterRoot) : null;
	return masterMap ? {
		...STANDARD_COLOR_MAP,
		...masterMap
	} : { ...STANDARD_COLOR_MAP };
};
const firstColorChild = (solidFill) => {
	for (const c of solidFill.children) if (c.kind === "element" && c.name.namespaceURI === NS.dml) return c;
	return null;
};
/**
* The concrete `#RRGGBB` color the deck paints body text in, resolved through
* the effective color map + theme. Read from the master's `bodyStyle` level-1
* default run properties; falls back to the `tx1` token resolved through the
* map. Returns `null` only when the deck carries no theme.
*
* Tables and charts authored by this library inherit no master text style, so
* their text otherwise falls back to `tx1` — which an inverted color map paints
* the SAME as the background, making the text invisible. Baking the body color
* in keeps generated tables / charts readable on whatever surface the deck uses.
*/
const resolveDeckBodyTextColor = (slide) => {
	const theme = themeFromPackage(slide[INTERNAL_PACKAGE]);
	if (!theme) return null;
	const clrMap = getEffectiveColorMap(slide);
	const masterRoot = getSlideMasterRoot(slide);
	if (masterRoot) {
		const txStyles = firstChildElement(masterRoot, NAME_TX_STYLES);
		const bodyStyle = txStyles ? firstChildElement(txStyles, NAME_BODY_STYLE) : null;
		const lvl1 = bodyStyle ? firstChildElement(bodyStyle, NAME_LVL1_PPR) : null;
		const defRPr = lvl1 ? firstChildElement(lvl1, NAME_DEF_RPR) : null;
		const solidFill = defRPr ? firstChildElement(defRPr, NAME_SOLID_FILL) : null;
		const colorEl = solidFill ? firstColorChild(solidFill) : null;
		if (colorEl) {
			const hex = resolveDrawingColor(colorEl, theme, clrMap);
			if (hex) return hex;
		}
	}
	return resolveSchemeToken("tx1", theme, clrMap);
};
//#endregion
//#region src/api/fn/charts.ts
const CHART_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const EMBEDDED_XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const allocateChartIndex = (pkg) => {
	let next = 1;
	const re = /^\/ppt\/charts\/chart(\d+)\.xml$/;
	for (const p of pkg.parts) {
		const m = p.name.match(re);
		if (m?.[1] !== void 0) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n) && n >= next) next = n + 1;
		}
	}
	return next;
};
const NAME_GRAPHIC_FRAME = qname("p", "graphicFrame", NS.pml);
const NAME_NV_GRAPHIC_FRAME_PR = qname("p", "nvGraphicFramePr", NS.pml);
const NAME_C_NV_PR_FN = qname("p", "cNvPr", NS.pml);
const NAME_C_NV_GRAPHIC_FRAME_PR = qname("p", "cNvGraphicFramePr", NS.pml);
const NAME_NV_PR = qname("p", "nvPr", NS.pml);
const NAME_XFRM = qname("p", "xfrm", NS.pml);
const NAME_OFF = qname("a", "off", NS.dml);
const NAME_EXT = qname("a", "ext", NS.dml);
const NAME_GRAPHIC = qname("a", "graphic", NS.dml);
const NAME_GRAPHIC_DATA = qname("a", "graphicData", NS.dml);
const NAME_C_CHART = qname("c", "chart", NS.chart);
const buildChartGraphicFrame = (opts) => {
	const nvGraphicFramePr = elem(NAME_NV_GRAPHIC_FRAME_PR, { children: [
		elem(NAME_C_NV_PR_FN, { attrs: [attr(qname("", "id", ""), String(opts.id)), attr(qname("", "name", ""), opts.name)] }),
		elem(NAME_C_NV_GRAPHIC_FRAME_PR),
		elem(NAME_NV_PR)
	] });
	const xfrm = elem(NAME_XFRM, { children: [elem(NAME_OFF, { attrs: [attr(qname("", "x", ""), String(emuCoordinate(opts.x, "addSlideChart: x"))), attr(qname("", "y", ""), String(emuCoordinate(opts.y, "addSlideChart: y")))] }), elem(NAME_EXT, { attrs: [attr(qname("", "cx", ""), String(emuExtent(opts.w, "addSlideChart: w"))), attr(qname("", "cy", ""), String(emuExtent(opts.h, "addSlideChart: h")))] })] });
	const chartRef = elem(NAME_C_CHART, {
		prefixDecls: new Map([["c", NS.chart], ["r", NS.officeDocRels]]),
		attrs: [attr(qname("r", "id", NS.officeDocRels), opts.rEmbed)]
	});
	return elem(NAME_GRAPHIC_FRAME, { children: [
		nvGraphicFramePr,
		xfrm,
		elem(NAME_GRAPHIC, { children: [elem(NAME_GRAPHIC_DATA, {
			attrs: [attr(qname("", "uri", ""), NS.chart)],
			children: [chartRef]
		})] })
	] });
};
const checkChartColor = (value, label) => {
	if (value === null || value === void 0) return;
	if (parseSrgbHex(value) === null) throw new Error(`${label}: invalid chart color ${JSON.stringify(value)} — expected an sRGB hex like "#4472C4" or "4472C4"`);
};
const validateChartSpecColors = (spec) => {
	checkChartColor(spec.plotAreaFill, "addSlideChart: plotAreaFill");
	checkChartColor(spec.plotAreaStrokeColor, "addSlideChart: plotAreaStrokeColor");
	checkChartColor(spec.chartAreaFill, "addSlideChart: chartAreaFill");
	checkChartColor(spec.chartAreaStrokeColor, "addSlideChart: chartAreaStrokeColor");
	checkChartColor(spec.valueAxisMajorGridlineColor, "addSlideChart: valueAxisMajorGridlineColor");
	checkChartColor(spec.valueAxisMinorGridlineColor, "addSlideChart: valueAxisMinorGridlineColor");
	checkChartColor(spec.categoryAxisMajorGridlineColor, "addSlideChart: categoryAxisMajorGridlineColor");
	checkChartColor(spec.categoryAxisMinorGridlineColor, "addSlideChart: categoryAxisMinorGridlineColor");
	checkChartColor(spec.valueAxisLineColor, "addSlideChart: valueAxisLineColor");
	checkChartColor(spec.categoryAxisLineColor, "addSlideChart: categoryAxisLineColor");
	checkChartColor(spec.secondaryValueAxis?.majorGridlineColor, "addSlideChart: secondaryValueAxis.majorGridlineColor");
	checkChartColor(spec.secondaryValueAxis?.lineColor, "addSlideChart: secondaryValueAxis.lineColor");
	checkChartColor(spec.dataLabels?.fillColor, "addSlideChart: dataLabels.fillColor");
	checkChartColor(spec.upDownBars?.upColor, "addSlideChart: upDownBars.upColor");
	checkChartColor(spec.upDownBars?.downColor, "addSlideChart: upDownBars.downColor");
	checkChartColor(spec.seriesAxis?.lineColor, "addSlideChart: seriesAxis.lineColor");
	spec.series.forEach((series, i) => {
		checkChartColor(series.color, `addSlideChart: series[${i}].color`);
		checkChartColor(series.lineColor, `addSlideChart: series[${i}].lineColor`);
		checkChartColor(series.markerColor, `addSlideChart: series[${i}].markerColor`);
		checkChartColor(series.markerLineColor, `addSlideChart: series[${i}].markerLineColor`);
		checkChartColor(series.trendline?.color, `addSlideChart: series[${i}].trendline.color`);
		checkChartColor(series.errorBars?.color, `addSlideChart: series[${i}].errorBars.color`);
		checkChartColor(series.xErrorBars?.color, `addSlideChart: series[${i}].xErrorBars.color`);
		checkChartColor(series.dataLabels?.fillColor, `addSlideChart: series[${i}].dataLabels.fillColor`);
		series.pointDataLabels?.forEach((label, j) => {
			checkChartColor(label?.fillColor, `addSlideChart: series[${i}].pointDataLabels[${j}].fillColor`);
		});
		series.pointColors?.forEach((c, j) => {
			checkChartColor(c, `addSlideChart: series[${i}].pointColors[${j}]`);
		});
	});
};
const validateChartSpecAxes = (spec) => {
	if (spec.series.length > 0 && spec.series.every((series) => series.secondaryAxis === true)) throw new Error("chart: at least one series must plot on the primary axis");
};
/**
* Adds a chart to the slide. Returns the new shape handle (kind
* `graphicFrame`). Every `ChartKind` is authorable, and the `view3D` /
* `ofPie` / `surfaceContour` modifiers reach the remaining plot-group
* elements (3-D bar / line / area / pie, pie-of-pie, contour) — see the
* table on `ChartKind`.
*
* Side effects:
*
*   - Allocates `/ppt/charts/chart{N}.xml` for the chart definition.
*   - Allocates `/ppt/embeddings/Microsoft_Excel_Worksheet{N}.xlsx` as
*     a placeholder workbook (single sheet, header row + one row per
*     category). PowerPoint reads the inline `<c:strCache>` /
*     `<c:numCache>` so the workbook is for "Edit data" only.
*   - Slide → chart and chart → workbook rels are wired with fresh rIds.
*   - `<a:graphicFrame>` is appended to the slide's `<p:spTree>`.
*
* Constraints:
*
*   - `pie` / `doughnut` charts require exactly one series; `stock`
*     charts exactly three (high, low, close) or four (open first).
*   - `scatter` / `bubble` series carry their own `xValues` (and
*     `bubbleSizes`); `categories` is unused for them.
*   - All other series should have at most `categories.length` values;
*     missing values are treated as blanks (gaps in the visualization).
*   - A spec whose fields contradict each other (e.g. `view3D` on a
*     scatter chart, error bars on a pie) throws instead of writing a
*     chart PowerPoint would repair.
*/
const withChartDefaultTextColor = (spec, color) => {
	if (color === null) return spec;
	const withColor = (style) => style === void 0 ? { color } : style.color === void 0 ? {
		...style,
		color
	} : style;
	const shared = {
		...spec.title !== void 0 ? { titleStyle: withColor(spec.titleStyle) } : {},
		...spec.legend !== void 0 ? { legend: {
			...spec.legend,
			textStyle: withColor(spec.legend.textStyle)
		} } : {},
		...spec.dataLabels !== void 0 ? { dataLabels: {
			...spec.dataLabels,
			textStyle: withColor(spec.dataLabels.textStyle)
		} } : {}
	};
	if (spec.kind === "pie" || spec.kind === "doughnut") return {
		...spec,
		...shared
	};
	const axisLabels = {
		categoryAxisLabelStyle: withColor(spec.categoryAxisLabelStyle),
		valueAxisLabelStyle: withColor(spec.valueAxisLabelStyle)
	};
	if (!(spec.view3D === void 0 && (spec.kind === "bar" || spec.kind === "column" || spec.kind === "line" || spec.kind === "area"))) return {
		...spec,
		...shared,
		...axisLabels
	};
	const hasSecondary = spec.series.some((series) => series.secondaryAxis === true);
	const secondary = spec.secondaryValueAxis ?? {};
	return {
		...spec,
		...shared,
		...axisLabels,
		...hasSecondary ? { secondaryValueAxis: {
			...secondary,
			labelStyle: withColor(secondary.labelStyle),
			...secondary.title !== void 0 ? { titleStyle: withColor(secondary.titleStyle) } : {}
		} } : {}
	};
};
const addSlideChart = (slide, opts) => {
	validateChartSpecEnums(opts.spec, "addSlideChart");
	validateChartSpecColors(opts.spec);
	validateChartSpecAxes(opts.spec);
	const spec = withChartDefaultTextColor(opts.spec, resolveDeckBodyTextColor(slide));
	const pkg = slide[INTERNAL_PACKAGE];
	const chartN = allocateChartIndex(pkg);
	const chartPartName = partName(`/ppt/charts/chart${chartN}.xml`);
	const xlsxPartName = partName(`/ppt/embeddings/Microsoft_Excel_Worksheet${chartN}.xlsx`);
	const xlsxBytes = buildEmbeddedXlsx(layoutChartSheet(spec).grid);
	const chartBytes = encode$1(serializeXml(buildChartSpaceDoc(spec)));
	pkg.addPart(chartPartName, CHART_CONTENT_TYPE, chartBytes);
	pkg.addPart(xlsxPartName, EMBEDDED_XLSX_CONTENT_TYPE, xlsxBytes);
	setOpcDefault(pkg, "rels", "application/vnd.openxmlformats-package.relationships+xml");
	const chartRels = emptyRels();
	chartRels.items.push({
		id: "rId1",
		type: REL_TYPES.package,
		target: `../embeddings/Microsoft_Excel_Worksheet${chartN}.xlsx`,
		targetMode: "Internal"
	});
	pkg.setRels(chartPartName, chartRels);
	const slideRels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
	const slideChartRId = nextRelId(slideRels.items.map((r) => r.id));
	slideRels.items.push({
		id: slideChartRId,
		type: REL_TYPES.chart,
		target: `../charts/chart${chartN}.xml`,
		targetMode: "Internal"
	});
	pkg.setRels(slide[SLIDE_PART_NAME], slideRels);
	return appendAndReturnNewShape(slide, buildChartGraphicFrame({
		id: nextShapeId(slide),
		name: opts.name ?? `Chart ${chartN}`,
		x: opts.x,
		y: opts.y,
		w: opts.w,
		h: opts.h,
		rEmbed: slideChartRId
	}));
};
const NAME_A_GRAPHIC_FN = qname("a", "graphic", NS.dml);
const NAME_A_GRAPHIC_DATA_FN = qname("a", "graphicData", NS.dml);
const NAME_C_CHART_FN = qname("c", "chart", NS.chart);
/**
* Resolves the chart part backing a graphic-frame shape, or `null` if
* the shape isn't a chart wrapper.
*/
const resolveChartPartName = (slide, shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "graphicFrame") return null;
	const graphic = firstChildElement(shape[SHAPE_ELEMENT], NAME_A_GRAPHIC_FN);
	if (!graphic) return null;
	const graphicData = firstChildElement(graphic, NAME_A_GRAPHIC_DATA_FN);
	if (!graphicData) return null;
	const chartRef = firstChildElement(graphicData, NAME_C_CHART_FN);
	if (!chartRef) return null;
	const rId = getAttrValue(chartRef, qname("r", "id", NS.officeDocRels));
	if (rId === null) return null;
	const slideRels = slide[INTERNAL_PACKAGE].getRels(slide[SLIDE_PART_NAME]);
	if (!slideRels) return null;
	const rel = slideRels.items.find((r) => r.id === rId);
	if (!rel) return null;
	return {
		partName: rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target),
		rId
	};
};
/**
* Replaces the chart definition on an existing graphic-frame chart
* shape. Updates the inline `<c:strCache>` / `<c:numCache>` blocks so
* PowerPoint renders the new data without opening the embedded
* workbook. The shape's geometry (position / size / rotation) is
* preserved verbatim.
*
* The embedded xlsx is re-written too — it's what the "Edit data"
* affordance opens. The previous workbook is replaced wholesale (no
* attempt to preserve styles a user added through Excel).
*
* Pass any `ChartSpec`, including a different `kind` from the
* original; this acts as "change my column chart to a line chart with
* fresh data."
*/
const setChartSpec = (chart, spec) => {
	validateChartSpecEnums(spec, "setChartSpec");
	validateChartSpecColors(spec);
	validateChartSpecAxes(spec);
	const slide = chart.shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	const resolved = resolveChartPartName(slide, chart.shape);
	if (!resolved) throw new Error("setChartSpec: shape is not a chart graphic frame");
	const chartBytes = encode$1(serializeXml(buildChartSpaceDoc(withChartDefaultTextColor(spec, resolveDeckBodyTextColor(slide)))));
	const chartPart = pkg.getPart(resolved.partName);
	if (!chartPart) throw new Error(`setChartSpec: chart part ${resolved.partName} not found`);
	chartPart.data = chartBytes;
	const chartRels = pkg.getRels(resolved.partName);
	if (chartRels) {
		const xlsxRel = chartRels.items.find((r) => r.type === REL_TYPES.package);
		if (xlsxRel) {
			const xlsxName = xlsxRel.target.startsWith("/") ? partName(xlsxRel.target) : resolveTarget(resolved.partName, xlsxRel.target);
			const xlsxPart = pkg.getPart(xlsxName);
			if (xlsxPart) xlsxPart.data = buildEmbeddedXlsx(layoutChartSheet(spec).grid);
		}
	}
};
/**
* Returns every chart on the slide, with its `ChartSpec` parsed from
* the linked chart part. Skips graphic frames that don't carry a
* `<c:chart>` reference (e.g. tables, diagrams).
*/
/**
* For a graphic-frame shape that wraps a chart, returns the parsed
* `ChartSpec`. Returns `null` when the shape isn't a chart wrapper
* or the chart uses a kind we don't model (e.g. surface, radar).
*
* Convenience over `getSlideCharts(...).find((c) => c.shape === shape)`
* when the caller already has the shape in hand (e.g. iterating
* `getSlideShapes`).
*/
/**
* Convenience over `getShapeChartSpec(shape)?.kind ?? null`. Returns
* the chart's `ChartKind` ('bar', 'line', 'pie', …) when the shape
* is a chart wrapper, or `null` for non-charts and charts whose
* kind isn't modeled yet.
*/
const getShapeChartKind = (shape) => {
	const spec = getShapeChartSpec(shape);
	return spec === null ? null : spec.kind;
};
/**
* Returns the categories axis labels of a chart shape, or `null`
* if the shape isn't a chart wrapper or its kind isn't modeled.
* Convenience over `getShapeChartSpec(shape)?.categories ?? null`.
*/
const getShapeChartCategories = (shape) => {
	const spec = getShapeChartSpec(shape);
	return spec === null ? null : spec.categories;
};
/**
* Returns the chart's series-name list (in spec order). `null`
* when the shape isn't a chart wrapper or the kind isn't modeled.
*/
const getShapeChartSeriesNames = (shape) => {
	const spec = getShapeChartSpec(shape);
	return spec === null ? null : spec.series.map((s) => s.name);
};
/**
* Returns the values for the named series on a chart shape, or
* `null` when the shape isn't a chart, the kind isn't modeled, or
* no series matches `seriesName`.
*
* For `scatter` / `bubble` charts the returned array is the series'
* y-channel (`<c:yVal>`); the paired x-channel and bubble sizes are on
* the full spec via `getShapeChartSpec` (`series[].xValues` /
* `series[].bubbleSizes`).
*/
const getShapeChartSeriesValues = (shape, seriesName) => {
	const spec = getShapeChartSpec(shape);
	if (spec === null) return null;
	const series = spec.series.find((s) => s.name === seriesName);
	return series ? series.values : null;
};
const getShapeChartSpec = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const resolved = resolveChartPartName(slide, shape);
	if (!resolved) return null;
	const part = slide[INTERNAL_PACKAGE].getPart(resolved.partName);
	if (!part) return null;
	try {
		const root = parseXml(decode$1(part.data)).root;
		return readChartSpec(root);
	} catch {
		return null;
	}
};
/**
* Returns every chart on the slide that carries a series whose name
* equals `seriesName` exactly. Useful for "find the revenue chart"
* patterns where chart kind alone isn't unique. Skips charts whose
* kind isn't modeled.
*/
const findChartsBySeriesName = (slide, seriesName) => {
	const out = [];
	for (const chart of getSlideCharts(slide)) {
		if (chart.spec === null) continue;
		if (chart.spec.series.some((s) => s.name === seriesName)) out.push(chart);
	}
	return out;
};
/**
* Returns every chart on the slide that carries at least one
* `<c:trendline>` on any of its series. Useful for deck-audit reports
* — trendlines are easy to add and easy to forget, and authors often
* want to inventory them before publishing. Skips charts whose kind
* isn't modeled.
*/
const findChartsWithTrendlines = (slide) => {
	const out = [];
	for (const chart of getSlideCharts(slide)) {
		if (chart.spec === null) continue;
		if (chart.spec.series.some((s) => s.trendline !== void 0)) out.push(chart);
	}
	return out;
};
/**
* Returns every chart on the slide whose `dataLabels` (chart-level)
* or any series-level `dataLabels` enable at least one of `showValue`,
* `showCategory`, `showSeriesName`, or `showPercent`. Useful for
* "which charts show numbers next to the data?" audits — purely
* presence-based; doesn't validate numberFormat or position. Charts
* whose kind isn't modeled are skipped.
*/
const findChartsWithDataLabels = (slide) => {
	const out = [];
	const hasLabel = (dl) => dl !== void 0 && Boolean(dl.showValue || dl.showCategory || dl.showSeriesName || dl.showPercent);
	for (const chart of getSlideCharts(slide)) {
		if (chart.spec === null) continue;
		if (hasLabel(chart.spec.dataLabels)) {
			out.push(chart);
			continue;
		}
		if (chart.spec.series.some((s) => hasLabel(s.dataLabels))) out.push(chart);
	}
	return out;
};
/**
* Returns the first chart on the slide whose parsed `kind` matches
* `kind` (e.g. `'bar'`, `'line'`, `'pie'`). Returns `null` when no
* chart on the slide has that kind, or when every chart on the slide
* uses a kind this version doesn't yet model.
*/
const findChartByKind = (slide, kind) => {
	for (const chart of getSlideCharts(slide)) if (chart.spec !== null && chart.spec.kind === kind) return chart;
	return null;
};
/**
* Histogram of chart kinds across the whole deck. Returns a frozen
* `Record<ChartKind, number>` with every kind present (zeros for any
* absent kind). Useful for deck-audit reports (e.g. "how many pie
* charts does this presentation have?") without iterating every slide
* by hand.
*
* Charts whose spec doesn't parse — typically a kind this version
* doesn't yet model — are skipped silently, mirroring
* `findChartByKind`'s null-spec handling.
*/
const getPresentationChartKindCounts = (pres) => {
	const counts = {
		bar: 0,
		column: 0,
		line: 0,
		pie: 0,
		doughnut: 0,
		area: 0,
		scatter: 0,
		radar: 0,
		bubble: 0,
		stock: 0,
		surface: 0
	};
	for (const slide of getSlides(pres)) for (const chart of getSlideCharts(slide)) {
		if (chart.spec === null) continue;
		counts[chart.spec.kind]++;
	}
	return counts;
};
/**
* Dense per-slide chart count array, 0-based by slide index. Counts
* every chart returned by `getSlideCharts` regardless of whether its
* `spec` parsed — useful for "which slides carry charts the renderer
* doesn't yet model?" audits. Pair with
* `getPresentationChartKindCounts` for kind-level totals.
*/
const getPresentationChartCountsBySlide = (pres) => getSlides(pres).map((s) => getSlideCharts(s).length);
const getSlideCharts = (slide) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) {
		const resolved = resolveChartPartName(slide, shape);
		if (!resolved) continue;
		const chartPart = pkg.getPart(resolved.partName);
		if (!chartPart) continue;
		let spec;
		try {
			const root = parseXml(decode$1(chartPart.data)).root;
			spec = readChartSpec(root);
		} catch {
			spec = null;
		}
		out.push({
			shape,
			spec
		});
	}
	return out;
};
//#endregion
//#region src/api/fn/shape-paragraph.ts
const NAME_A_DEF_RPR = qname("a", "defRPr", NS.dml);
const NAME_A_END_PARA_RPR$1 = qname("a", "endParaRPr", NS.dml);
const NAME_A_LST_STYLE = qname("a", "lstStyle", NS.dml);
const NAME_P_TX_BODY_PML = qname("p", "txBody", NS.pml);
const NAME_P_TX_STYLES = qname("p", "txStyles", NS.pml);
const NAME_P_TITLE_STYLE = qname("p", "titleStyle", NS.pml);
const NAME_P_BODY_STYLE = qname("p", "bodyStyle", NS.pml);
const NAME_P_OTHER_STYLE = qname("p", "otherStyle", NS.pml);
const mergeRPrLayer = (base, layer) => {
	if (base.font === void 0 && layer.font !== void 0) base.font = layer.font;
	if (base.fontEastAsian === void 0 && layer.fontEastAsian !== void 0) base.fontEastAsian = layer.fontEastAsian;
	if (base.fontComplexScript === void 0 && layer.fontComplexScript !== void 0) base.fontComplexScript = layer.fontComplexScript;
	if (base.size === void 0 && layer.size !== void 0) base.size = layer.size;
	if (base.color === void 0 && layer.color !== void 0) base.color = layer.color;
	if (base.bold === void 0 && layer.bold !== void 0) base.bold = layer.bold;
	if (base.italic === void 0 && layer.italic !== void 0) base.italic = layer.italic;
	if (base.underline === void 0 && layer.underline !== void 0) base.underline = layer.underline;
	if (base.strike === void 0 && layer.strike !== void 0) base.strike = layer.strike;
	if (base.spc === void 0 && layer.spc !== void 0) base.spc = layer.spc;
	if (base.kern === void 0 && layer.kern !== void 0) base.kern = layer.kern;
	if (base.baseline === void 0 && layer.baseline !== void 0) base.baseline = layer.baseline;
	if (base.cap === void 0 && layer.cap !== void 0) base.cap = layer.cap;
	if (base.highlight === void 0 && layer.highlight !== void 0) base.highlight = layer.highlight;
};
const lstStyleLevelDefRPr = (lstStyle, level) => {
	if (!lstStyle) return null;
	const lvlPPr = firstChildElement(lstStyle, qname("a", `lvl${Math.max(0, Math.min(8, level)) + 1}pPr`, NS.dml));
	if (!lvlPPr) {
		if (level !== 0) return null;
		const defPPr = firstChildElement(lstStyle, qname("a", "defPPr", NS.dml));
		if (!defPPr) return null;
		return firstChildElement(defPPr, NAME_A_DEF_RPR);
	}
	return firstChildElement(lvlPPr, NAME_A_DEF_RPR);
};
const lstStyleLevelPPr = (lstStyle, level) => {
	if (!lstStyle) return null;
	const lvlPPr = firstChildElement(lstStyle, qname("a", `lvl${Math.max(0, Math.min(8, level)) + 1}pPr`, NS.dml));
	if (lvlPPr) return lvlPPr;
	if (level !== 0) return null;
	return firstChildElement(lstStyle, qname("a", "defPPr", NS.dml));
};
const findShapeLstStyleElement = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_P_TX_BODY_PML);
	if (!txBody) return null;
	return firstChildElement(txBody, NAME_A_LST_STYLE);
};
const findPlaceholderShapeIn = (shapes, phIdx, phType) => matchPlaceholderShape(shapes, phIdx, phType);
const extractPlaceholderLstStyle = (placeholderEl) => {
	const txBody = firstChildElement(placeholderEl, NAME_P_TX_BODY_PML);
	if (!txBody) return null;
	return firstChildElement(txBody, NAME_A_LST_STYLE);
};
const NAME_P_NV_SP_PR$1 = qname("p", "nvSpPr", NS.pml);
const NAME_P_NV_PR = qname("p", "nvPr", NS.pml);
const NAME_P_PH = qname("p", "ph", NS.pml);
const shapeIsPlaceholder = (shape) => {
	const nvSpPr = firstChildElement(shape[SHAPE_ELEMENT], NAME_P_NV_SP_PR$1);
	if (!nvSpPr) return false;
	const nvPr = firstChildElement(nvSpPr, NAME_P_NV_PR);
	return nvPr !== null && firstChildElement(nvPr, NAME_P_PH) !== null;
};
const masterTxStyleFor = (masterRoot, phType) => {
	const txStyles = firstChildElement(masterRoot, NAME_P_TX_STYLES);
	if (!txStyles) return null;
	if (phType === "title" || phType === "ctrTitle") return firstChildElement(txStyles, NAME_P_TITLE_STYLE);
	if (phType === "body" || phType === "subTitle" || phType === null) return firstChildElement(txStyles, NAME_P_BODY_STYLE);
	return firstChildElement(txStyles, NAME_P_OTHER_STYLE);
};
/**
* Resolves a run's effective character properties by walking the
* ECMA-376 §21.1.2.4.7 inheritance chain — run rPr → endParaRPr →
* pPr defRPr → text-body lstStyle → layout placeholder lstStyle →
* master placeholder lstStyle + master txStyles → theme fontScheme.
*
* Each property (font, size, color, bold, italic, underline) is
* resolved independently: the innermost layer that supplies a value
* wins for that one property.
*
* Returns a non-null `TextFormat`; fields the cascade couldn't
* resolve are simply absent (the renderer falls back to placeholder
* defaults).
*
* Use `getShapeRunFormat` if you only want the literal `<a:rPr>` on
* the run without inheritance.
*/
const NAME_TX_BODY$2 = qname("p", "txBody", NS.pml);
const getShapeRunFormatEffective = (pres, shape, paragraphIndex, runIndex) => {
	const paragraph = requireParagraph(shape, paragraphIndex);
	const run = requireRun(shape, paragraphIndex, runIndex);
	const result = {};
	const ctx = { theme: getPresentationTheme(pres) };
	const pPr = firstChildElement(paragraph, NAME_A_PPR);
	let level = 0;
	if (pPr) {
		const lvlAttr = getAttrValue(pPr, ATTR_LVL);
		if (lvlAttr !== null) {
			const parsed = Number.parseInt(lvlAttr, 10);
			if (Number.isFinite(parsed)) level = parsed;
		}
	}
	const runRPr = firstChildElement(run, NAME_A_RPR);
	if (runRPr) mergeRPrLayer(result, parseRPrLikeElement(runRPr, ctx));
	const runs = runsOf(paragraph);
	if (runs.length > 0 && runs[runs.length - 1] === run) {
		const endRPr = firstChildElement(paragraph, NAME_A_END_PARA_RPR$1);
		if (endRPr) mergeRPrLayer(result, parseRPrLikeElement(endRPr, ctx));
	}
	if (pPr) {
		const defRPr = firstChildElement(pPr, NAME_A_DEF_RPR);
		if (defRPr) mergeRPrLayer(result, parseRPrLikeElement(defRPr, ctx));
	}
	const shapeLvlDef = lstStyleLevelDefRPr(findShapeLstStyleElement(shape), level);
	if (shapeLvlDef) mergeRPrLayer(result, parseRPrLikeElement(shapeLvlDef, ctx));
	const phIdx = getShapePlaceholderIdx(shape);
	const phType = getShapePlaceholderType(shape);
	const isPlaceholder = shapeIsPlaceholder(shape);
	const slide = shape[SHAPE_SLIDE];
	const layout = getSlideLayout(slide);
	if (layout && isPlaceholder) {
		const layoutPh = findPlaceholderShapeIn(layout[LAYOUT_PART].shapes, phIdx, phType);
		if (layoutPh) {
			const layoutLvlDef = lstStyleLevelDefRPr(extractPlaceholderLstStyle(layoutPh.element), level);
			if (layoutLvlDef) mergeRPrLayer(result, parseRPrLikeElement(layoutLvlDef, ctx));
		}
		const pkg = pres[INTERNAL_PACKAGE];
		const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
		const layoutRels = pkg.getRels(layoutPartName);
		if (layoutRels) {
			const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
			if (masterRel) {
				const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
				if (masterPart) {
					const masterRoot = parseXml(decode$1(masterPart.data)).root;
					const { shapes: masterShapes } = readShapeTreeFromCsldRoot(masterRoot, "sldMaster");
					const masterPh = findPlaceholderShapeIn(masterShapes, phIdx, phType);
					if (masterPh) {
						const masterLvlDef = lstStyleLevelDefRPr(extractPlaceholderLstStyle(masterPh.element), level);
						if (masterLvlDef) mergeRPrLayer(result, parseRPrLikeElement(masterLvlDef, ctx));
					}
					const txLvlDef = lstStyleLevelDefRPr(masterTxStyleFor(masterRoot, phType), level);
					if (txLvlDef) mergeRPrLayer(result, parseRPrLikeElement(txLvlDef, ctx));
				}
			}
		}
	}
	const fonts = getPresentationFonts(pres);
	if (fonts) {
		const resolveThemeToken = (token) => {
			switch (token) {
				case "+mj-lt": return fonts.majorLatin ?? void 0;
				case "+mn-lt": return fonts.minorLatin ?? void 0;
				case "+mj-ea": return fonts.majorEastAsian ?? void 0;
				case "+mn-ea": return fonts.minorEastAsian ?? void 0;
				case "+mj-cs": return fonts.majorComplexScript ?? void 0;
				case "+mn-cs": return fonts.minorComplexScript ?? void 0;
				default: return;
			}
		};
		if (typeof result.font === "string" && result.font.startsWith("+")) {
			const resolved = resolveThemeToken(result.font);
			if (resolved) result.font = resolved;
		}
		if (result.font === void 0) {
			const fallback = phType === "title" || phType === "ctrTitle" ? fonts.majorLatin : fonts.minorLatin;
			if (fallback) result.font = fallback;
		}
		if (typeof result.fontEastAsian === "string" && result.fontEastAsian.startsWith("+")) {
			const resolved = resolveThemeToken(result.fontEastAsian);
			if (resolved) result.fontEastAsian = resolved;
		}
		if (result.fontEastAsian === void 0) {
			const fallback = phType === "title" || phType === "ctrTitle" ? fonts.majorEastAsian : fonts.minorEastAsian;
			if (fallback) result.fontEastAsian = fallback;
		}
		if (typeof result.fontComplexScript === "string" && result.fontComplexScript.startsWith("+")) {
			const resolved = resolveThemeToken(result.fontComplexScript);
			if (resolved) result.fontComplexScript = resolved;
		}
		if (result.fontComplexScript === void 0) {
			const fallback = phType === "title" || phType === "ctrTitle" ? fonts.majorComplexScript : fonts.minorComplexScript;
			if (fallback) result.fontComplexScript = fallback;
		}
	}
	return result;
};
/**
* Maps an OOXML `algn` token to the friendly `ParagraphAlignment` form the
* rest of the API speaks. Exported so the table-cell reader normalises the
* same way the shape-text cascade does.
*
* @internal
*/
const ALIGN_TOKEN_MAP = {
	l: "left",
	ctr: "center",
	r: "right",
	just: "justify",
	justLow: "justify",
	dist: "distribute",
	thaiDist: "distribute"
};
const parsePPrLikeElement = (pPr) => {
	const out = {};
	const algn = getAttrValue(pPr, qname("", "algn", ""));
	if (algn !== null && ALIGN_TOKEN_MAP[algn] !== void 0) out.align = ALIGN_TOKEN_MAP[algn];
	const marL = getAttrValue(pPr, qname("", "marL", ""));
	if (marL !== null) {
		const n = Number.parseInt(marL, 10);
		if (Number.isFinite(n)) out.marL = n;
	}
	const marR = getAttrValue(pPr, qname("", "marR", ""));
	if (marR !== null) {
		const n = Number.parseInt(marR, 10);
		if (Number.isFinite(n)) out.marR = n;
	}
	const indent = getAttrValue(pPr, qname("", "indent", ""));
	if (indent !== null) {
		const n = Number.parseInt(indent, 10);
		if (Number.isFinite(n)) out.indent = n;
	}
	const rtl = getAttrValue(pPr, qname("", "rtl", ""));
	if (rtl !== null) out.rtl = rtl === "1" || rtl === "true";
	const lnSpc = firstChildElement(pPr, qname("a", "lnSpc", NS.dml));
	if (lnSpc) {
		const pct = firstChildElement(lnSpc, qname("a", "spcPct", NS.dml));
		if (pct) {
			const v = getAttrValue(pct, qname("", "val", ""));
			if (v !== null) {
				let n = Number.parseFloat(v);
				if (Number.isFinite(n)) {
					if (Math.abs(n) > 1) n = n / 1e5;
					out.lineSpacing = {
						kind: "pct",
						value: n
					};
				}
			}
		} else {
			const pts = firstChildElement(lnSpc, qname("a", "spcPts", NS.dml));
			if (pts) {
				const v = getAttrValue(pts, qname("", "val", ""));
				if (v !== null) {
					const n = Number.parseInt(v, 10);
					if (Number.isFinite(n)) out.lineSpacing = {
						kind: "pts",
						value: n / 100
					};
				}
			}
		}
	}
	const readSpcSide = (local) => {
		const side = firstChildElement(pPr, qname("a", local, NS.dml));
		if (!side) return null;
		const pts = firstChildElement(side, qname("a", "spcPts", NS.dml));
		if (!pts) return null;
		const v = getAttrValue(pts, qname("", "val", ""));
		if (v === null) return null;
		const n = Number.parseInt(v, 10);
		return Number.isFinite(n) ? n / 100 : null;
	};
	const before = readSpcSide("spcBef");
	if (before !== null) out.spcBefPts = before;
	const after = readSpcSide("spcAft");
	if (after !== null) out.spcAftPts = after;
	for (const c of pPr.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "buNone") out.bullet = "none";
		else if (c.name.localName === "buChar") {
			const char = getAttrValue(c, qname("", "char", ""));
			if (char === "•") out.bullet = "bullet";
			else if (char !== null) out.bullet = { char };
		} else if (c.name.localName === "buAutoNum") {
			const t = getAttrValue(c, qname("", "type", ""));
			if (t === "arabicPeriod") out.bullet = "number";
			else if (t !== null) out.bullet = { autoNum: t };
		}
	}
	return out;
};
const mergePPrLayer = (base, layer) => {
	if (base.align === void 0 && layer.align !== void 0) base.align = layer.align;
	if (base.marL === void 0 && layer.marL !== void 0) base.marL = layer.marL;
	if (base.marR === void 0 && layer.marR !== void 0) base.marR = layer.marR;
	if (base.indent === void 0 && layer.indent !== void 0) base.indent = layer.indent;
	if (base.rtl === void 0 && layer.rtl !== void 0) base.rtl = layer.rtl;
	if (base.lineSpacing === void 0 && layer.lineSpacing !== void 0) base.lineSpacing = layer.lineSpacing;
	if (base.spcBefPts === void 0 && layer.spcBefPts !== void 0) base.spcBefPts = layer.spcBefPts;
	if (base.spcAftPts === void 0 && layer.spcAftPts !== void 0) base.spcAftPts = layer.spcAftPts;
	if (base.bullet === void 0 && layer.bullet !== void 0) base.bullet = layer.bullet;
};
/**
* Resolves a paragraph's effective properties by walking the same
* inheritance chain `getShapeRunFormatEffective` uses, but for the
* paragraph-level surface:
*
*   - alignment, indent (left / right / first-line), line spacing,
*     paragraph spacing (before / after), rtl.
*
* Each property is resolved independently; the innermost layer that
* sets it wins. Fields the cascade can't resolve come through as `null`
* so renderers know to fall back to their own defaults.
*
* Companion to `getParagraphAlignment` / `getParagraphLineSpacing` /
* `getParagraphIndent` / `getParagraphSpacing`, which only surface the
* literal `<a:pPr>` and skip the layout / master cascade.
*/
const getParagraphPropertiesEffective = (pres, shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	let level = 0;
	if (pPr) {
		const lvlAttr = getAttrValue(pPr, ATTR_LVL);
		if (lvlAttr !== null) {
			const parsed = Number.parseInt(lvlAttr, 10);
			if (Number.isFinite(parsed)) level = parsed;
		}
	}
	const result = {};
	if (pPr) mergePPrLayer(result, parsePPrLikeElement(pPr));
	const shapeLvlPPr = lstStyleLevelPPr(findShapeLstStyleElement(shape), level);
	if (shapeLvlPPr) mergePPrLayer(result, parsePPrLikeElement(shapeLvlPPr));
	const phIdx = getShapePlaceholderIdx(shape);
	const phType = getShapePlaceholderType(shape);
	const isPlaceholder = shapeIsPlaceholder(shape);
	const slide = shape[SHAPE_SLIDE];
	const layout = getSlideLayout(slide);
	if (layout && isPlaceholder) {
		const layoutPh = findPlaceholderShapeIn(layout[LAYOUT_PART].shapes, phIdx, phType);
		if (layoutPh) {
			const layoutLvlPPr = lstStyleLevelPPr(extractPlaceholderLstStyle(layoutPh.element), level);
			if (layoutLvlPPr) mergePPrLayer(result, parsePPrLikeElement(layoutLvlPPr));
		}
		const pkg = pres[INTERNAL_PACKAGE];
		const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
		const layoutRels = pkg.getRels(layoutPartName);
		if (layoutRels) {
			const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
			if (masterRel) {
				const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
				if (masterPart) {
					const masterRoot = parseXml(decode$1(masterPart.data)).root;
					const { shapes: masterShapes } = readShapeTreeFromCsldRoot(masterRoot, "sldMaster");
					const masterPh = findPlaceholderShapeIn(masterShapes, phIdx, phType);
					if (masterPh) {
						const masterLvlPPr = lstStyleLevelPPr(extractPlaceholderLstStyle(masterPh.element), level);
						if (masterLvlPPr) mergePPrLayer(result, parsePPrLikeElement(masterLvlPPr));
					}
					const txLvlPPr = lstStyleLevelPPr(masterTxStyleFor(masterRoot, phType), level);
					if (txLvlPPr) mergePPrLayer(result, parsePPrLikeElement(txLvlPPr));
				}
			}
		}
	}
	return {
		align: result.align ?? null,
		level,
		marL: result.marL ?? null,
		marR: result.marR ?? null,
		indent: result.indent ?? null,
		lineSpacing: result.lineSpacing ?? null,
		spcBefPts: result.spcBefPts ?? null,
		spcAftPts: result.spcAftPts ?? null,
		rtl: result.rtl ?? null,
		bullet: result.bullet ?? null
	};
};
/**
* Applies `format` to a single run. Run-property attributes not
* addressed by `format` are preserved — partial updates compose.
*
* Example: bold the second word of the first paragraph:
*
*   setShapeRunFormat(shape, 0, 1, { bold: true, color: '#FF0000' });
*/
const setShapeRunFormat = (shape, paragraphIndex, runIndex, format) => {
	applyRunFormat(ensureRPr(requireRun(shape, paragraphIndex, runIndex)), format);
	commitAndRefresh(shape);
};
/**
* Reads the external URL the first run in the shape's text-body links
* to (set via `setShapeHyperlink`). Returns `null` when no run carries
* an `<a:hlinkClick r:id=…/>` or the rId resolves to a non-hyperlink
* target.
*/
const getShapeHyperlink = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "shape") return null;
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY$2);
	if (!txBody) return null;
	for (const p of txBody.children) {
		if (p.kind !== "element" || p.name.namespaceURI !== NS.dml || p.name.localName !== "p") continue;
		for (const r of p.children) {
			if (r.kind !== "element" || r.name.namespaceURI !== NS.dml || r.name.localName !== "r") continue;
			const rPr = firstChildElement(r, qname("a", "rPr", NS.dml));
			if (!rPr) continue;
			const hlink = firstChildElement(rPr, qname("a", "hlinkClick", NS.dml));
			if (!hlink) continue;
			const rId = getAttrValue(hlink, qname("r", "id", NS.officeDocRels));
			if (!rId) continue;
			const slide = shape[SHAPE_SLIDE];
			const rels = slide[INTERNAL_PACKAGE].getRels(slide[SLIDE_PART_NAME]);
			if (!rels) continue;
			const rel = rels.items.find((x) => x.id === rId);
			if (rel?.type === REL_TYPES.hyperlink && rel.targetMode === "External") return rel.target;
		}
	}
	return null;
};
/**
* Sets an external hyperlink on every run in the shape's text. Allocates
* (or reuses) a `hyperlink` relationship on the slide's `.rels`. Pass
* `null` to clear.
*/
const setShapeHyperlink = (shape, url, tooltip) => {
	const slide = shape[SHAPE_SLIDE];
	const txBody = requireTxBody(shape);
	if (url === null) applyHyperlinkToAllRuns(txBody, null);
	else {
		const pkg = slide[INTERNAL_PACKAGE];
		const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
		applyHyperlinkToAllRuns(txBody, rels.items.find((r) => r.type === REL_TYPES.hyperlink && r.target === url && r.targetMode === "External")?.id ?? (() => {
			const nextId = nextRelId(rels.items.map((r) => r.id));
			rels.items.push({
				id: nextId,
				type: REL_TYPES.hyperlink,
				target: url,
				targetMode: "External"
			});
			pkg.setRels(slide[SLIDE_PART_NAME], rels);
			return nextId;
		})(), tooltip);
	}
	commitAndRefresh(shape);
	releaseUnusedLinkRels(slide);
};
//#endregion
//#region src/api/fn/layouts.ts
/** PowerPoint's user-visible layout name. */
const getSlideLayoutName = (layout) => layout[LAYOUT_PART].name;
/**
* Returns the package part name (e.g. `/ppt/slideLayouts/slideLayout3.xml`)
* of `layout`. Useful for surfacing layouts in validator output and
* other path-keyed UIs.
*/
const getSlideLayoutPartName = (layout) => layout[LAYOUT_PART_NAME];
/**
* Returns the slide layout whose package part name equals
* `partName`, or `null` when no such layout exists. Mirror of
* `findSlideByPartName` for layouts.
*/
const findSlideLayoutByPartName = (pres, partName) => {
	for (const layout of getSlideLayouts(pres)) if (layout[LAYOUT_PART_NAME] === partName) return layout;
	return null;
};
/**
* Enumerates the placeholder shapes on a slide layout. Non-placeholder
* shapes (decorative rectangles, watermarks added to the layout) are
* filtered out; only entries with a `<p:ph>` element are returned.
*
* Use this when you need to discover which placeholder indices a
* layout exposes — e.g. before `findSlidePlaceholder(slide, ...)` to
* confirm the slot exists.
*/
const getSlideLayoutPlaceholders = (layout) => {
	const out = [];
	for (const shape of layout[LAYOUT_PART].shapes) {
		if (shape.placeholderType === null && shape.placeholderIdx === null) continue;
		const pos = readPosition(shape.element, shape.kind);
		const size = readSize(shape.element, shape.kind);
		const bounds = pos === null || size === null ? null : {
			x: pos.x,
			y: pos.y,
			w: size.w,
			h: size.h
		};
		out.push({
			type: shape.placeholderType,
			idx: shape.placeholderIdx,
			name: shape.name,
			bounds
		});
	}
	return out;
};
/**
* Finds the first slide layout whose user-visible name matches `name`,
* or `null` if none does. Accepts a literal string (exact equality)
* or a `RegExp` for pattern matches — useful when template providers
* suffix versions onto names (`'Title and Content v2'`).
*
* String matching is **case-sensitive** and exact: `findSlideLayout(pres,
* 'Blank')` matches a layout named `"Blank"` but not `"blank"`. The
* user-visible name is also locale-dependent (a deck authored in a
* non-English PowerPoint localizes `"Blank"`), so prefer
* {@link findSlideLayoutByType} — which matches the locale-stable
* `<p:sldLayout type="…">` token (`'blank'`, `'title'`, `'obj'`, …) —
* when you need a robust lookup. Pass a `RegExp` with the `i` flag here
* for a case-insensitive name match.
*/
const findSlideLayout = (pres, name) => {
	for (const layout of getSlideLayouts(pres)) {
		const n = layout[LAYOUT_PART].name;
		if (typeof name === "string" ? n === name : name.test(n)) return layout;
	}
	return null;
};
/**
* Returns every slide layout in the package that exposes a
* placeholder of the given type token (`'title'`, `'body'`,
* `'ftr'`, etc.). Useful for "find every layout that can host a
* body" lookups before `addSlide`.
*/
const findLayoutsWithPlaceholderType = (pres, type) => {
	const out = [];
	for (const layout of getSlideLayouts(pres)) if (getSlideLayoutPlaceholders(layout).some((p) => p.type === type || type === "body" && p.type === null && p.idx !== null)) out.push(layout);
	return out;
};
/**
* Finds the first slide layout with the given `<p:sldLayout type="...">`
* token. Unlike `findSlideLayout` (which matches the user-visible
* name, and is therefore locale-sensitive), this matches the spec
* token — `title`, `obj`, `twoObj`, `blank`, etc. — and is stable
* across PowerPoint UI languages.
*/
const findSlideLayoutByType = (pres, layoutType) => {
	for (const layout of getSlideLayouts(pres)) if (layout[LAYOUT_PART].layoutType === layoutType) return layout;
	return null;
};
/**
* Layout type token, when present (`title`, `obj`, `twoObj`, ...).
* `null` when omitted — the spec default for that case is `cust`.
*/
const getSlideLayoutType = (layout) => layout[LAYOUT_PART].layoutType;
/**
* Enumerates every slide layout in the package.
*/
const getSlideLayouts = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const out = [];
	for (const part of pkg.parts) {
		if (part.contentType !== "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml") continue;
		const root = parseXml(decode$1(part.data)).root;
		out.push({
			[LAYOUT_PART_NAME]: part.name,
			[LAYOUT_PART]: readSlideLayoutPart(root)
		});
	}
	return out;
};
/**
* Layouts in the package that no slide references. Useful when
* trimming a template deck — these layouts contribute parts and rels
* without ever rendering. Iteration order matches `getSlideLayouts`.
*/
const getUnusedSlideLayouts = (pres) => {
	const referenced = /* @__PURE__ */ new Set();
	for (const slide of getSlides(pres)) {
		const layout = getSlideLayout(slide);
		if (layout !== null) referenced.add(getSlideLayoutName(layout));
	}
	return getSlideLayouts(pres).filter((l) => !referenced.has(getSlideLayoutName(l)));
};
/**
* Returns a map of layout name → number of slides that reference it.
* Every layout enumerated by `getSlideLayouts` appears as a key (zero
* count for unreferenced layouts), so this surfaces unused layouts
* directly — e.g. for templates that ship with placeholder layouts the
* deck never picks up.
*/
/**
* Histogram of slide-layout type token (e.g. `title`, `obj`, `twoObj`,
* `blank`) → number of slides that use a layout of that type. Useful
* for "how many content slides vs. dividers vs. title slides?" audits
* — keyed on the OOXML enum, so stable across locales (unlike
* `getSlideLayoutUsageCounts`, which keys on the user-visible name).
* Layouts with no `type` token are skipped (the spec default is
* `cust`).
*/
const getSlideLayoutUsageCountsByType = (pres) => {
	const counts = {};
	for (const slide of getSlides(pres)) {
		const layout = getSlideLayout(slide);
		if (layout === null) continue;
		const t = layout[LAYOUT_PART].layoutType;
		if (t === null) continue;
		counts[t] = (counts[t] ?? 0) + 1;
	}
	return counts;
};
const getSlideLayoutUsageCounts = (pres) => {
	const counts = {};
	for (const layout of getSlideLayouts(pres)) counts[getSlideLayoutName(layout)] = 0;
	for (const slide of getSlides(pres)) {
		const layout = getSlideLayout(slide);
		if (layout === null) continue;
		const name = getSlideLayoutName(layout);
		counts[name] = (counts[name] ?? 0) + 1;
	}
	return counts;
};
//#endregion
//#region src/api/fn/properties.ts
const NS_CORE_PROPS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_DCTERMS = "http://purl.org/dc/terms/";
const CORE_PROPS_PART_NAME = partName("/docProps/core.xml");
/**
* Reads `/docProps/core.xml`. Returns `null` when the package has
* no core-properties part. Each field is `null` when the
* corresponding element is absent or empty.
*/
/**
* Convenience: bumps core-properties' `cp:revision` by one (treating
* an unset / unparseable value as 0). Returns the new revision
* number. Useful right before `savePresentation` so consumers can
* tell decks apart.
*/
const incrementRevision = (pres) => {
	const props = getCoreProperties(pres);
	const current = props?.revision === null || props?.revision === void 0 ? 0 : Number.parseInt(props.revision, 10);
	const next = (Number.isFinite(current) ? current : 0) + 1;
	setCoreProperties(pres, { revision: String(next) });
	return next;
};
/**
* Convenience: writes `new Date().toISOString()` to
* `dcterms:modified`. Useful right before `savePresentation` so
* "last edited" shows the actual save time. Pass an explicit
* `Date` to set a specific value.
*/
const touchModified = (pres, at = /* @__PURE__ */ new Date()) => {
	setCoreProperties(pres, { modified: at.toISOString() });
};
/**
* Convenience: the timestamp from core-properties' `dcterms:created`,
* parsed as a `Date`. Returns `null` when no created field is set
* or the value isn't a recognizable W3C-DTF / ISO-8601 string.
*/
const getPresentationCreated = (pres) => {
	const props = getCoreProperties(pres);
	if (!props || props.created === null) return null;
	const d = new Date(props.created);
	return Number.isFinite(d.getTime()) ? d : null;
};
/**
* Convenience: the timestamp from core-properties' `dcterms:modified`,
* parsed as a `Date`. Returns `null` when no modified field is set
* or the value isn't a recognizable W3C-DTF / ISO-8601 string.
*/
const getPresentationModified = (pres) => {
	const props = getCoreProperties(pres);
	if (!props || props.modified === null) return null;
	const d = new Date(props.modified);
	return Number.isFinite(d.getTime()) ? d : null;
};
const getCoreProperties = (pres) => {
	const part = pres[INTERNAL_PACKAGE].getPart(CORE_PROPS_PART_NAME);
	if (!part) return null;
	const root = parseXml(decode$1(part.data)).root;
	const read = (uri, local) => {
		const el = firstChildElement(root, qname("", local, uri));
		if (!el) return null;
		let s = "";
		for (const c of el.children) if (c.kind === "text") s += c.data;
		return s.length === 0 ? null : s;
	};
	return {
		title: read(NS_DC, "title"),
		subject: read(NS_DC, "subject"),
		creator: read(NS_DC, "creator"),
		keywords: read(NS_CORE_PROPS, "keywords"),
		description: read(NS_DC, "description"),
		lastModifiedBy: read(NS_CORE_PROPS, "lastModifiedBy"),
		revision: read(NS_CORE_PROPS, "revision"),
		created: read(NS_DCTERMS, "created"),
		modified: read(NS_DCTERMS, "modified"),
		category: read(NS_CORE_PROPS, "category")
	};
};
const CORE_PROPS_CONTENT_TYPE = "application/vnd.openxmlformats-package.core-properties+xml";
const CORE_PROP_FIELDS = [
	{
		key: "title",
		uri: NS_DC,
		prefix: "dc",
		local: "title"
	},
	{
		key: "subject",
		uri: NS_DC,
		prefix: "dc",
		local: "subject"
	},
	{
		key: "creator",
		uri: NS_DC,
		prefix: "dc",
		local: "creator"
	},
	{
		key: "keywords",
		uri: NS_CORE_PROPS,
		prefix: "cp",
		local: "keywords"
	},
	{
		key: "description",
		uri: NS_DC,
		prefix: "dc",
		local: "description"
	},
	{
		key: "lastModifiedBy",
		uri: NS_CORE_PROPS,
		prefix: "cp",
		local: "lastModifiedBy"
	},
	{
		key: "revision",
		uri: NS_CORE_PROPS,
		prefix: "cp",
		local: "revision"
	},
	{
		key: "created",
		uri: NS_DCTERMS,
		prefix: "dcterms",
		local: "created"
	},
	{
		key: "modified",
		uri: NS_DCTERMS,
		prefix: "dcterms",
		local: "modified"
	},
	{
		key: "category",
		uri: NS_CORE_PROPS,
		prefix: "cp",
		local: "category"
	}
];
const buildEmptyCorePropsRoot = () => {
	const prefixDecls = new Map([
		["cp", NS_CORE_PROPS],
		["dc", NS_DC],
		["dcterms", NS_DCTERMS]
	]);
	return {
		kind: "element",
		name: qname("cp", "coreProperties", NS_CORE_PROPS),
		attrs: [],
		prefixDecls,
		children: []
	};
};
/**
* Writes selected fields on `/docProps/core.xml`. Unspecified fields
* are left as-is; pass `null` to clear a field that's currently set.
* Bootstraps the part (and the `/_rels/.rels` entry + content-type
* override) if the package didn't have one.
*
* Note: setting `created` / `modified` requires an ISO-8601 timestamp
* string (e.g. `'2026-05-15T12:34:56Z'`). PowerPoint expects the
* `xsi:type="dcterms:W3CDTF"` attribute on these elements but readers
* we tested all accept missing-attribute output too; this helper
* therefore omits the attribute for simplicity.
*/
const setCoreProperties = (pres, values) => {
	const pkg = pres[INTERNAL_PACKAGE];
	let part = pkg.getPart(CORE_PROPS_PART_NAME);
	let root;
	let doc;
	if (part) {
		doc = parseXml(decode$1(part.data));
		root = doc.root;
	} else {
		root = buildEmptyCorePropsRoot();
		doc = {
			kind: "document",
			decl: null,
			prolog: [],
			root,
			epilog: []
		};
	}
	for (const field of CORE_PROP_FIELDS) {
		if (!(field.key in values)) continue;
		const value = values[field.key] ?? null;
		const name = qname(field.prefix, field.local, field.uri);
		const existing = firstChildElement(root, name);
		if (value === null) {
			if (existing) existing.children = [];
			continue;
		}
		if (existing) existing.children = [text(value)];
		else root.children.push(elem(name, { children: [text(value)] }));
	}
	const bytes = encode$1(serializeXml(doc));
	if (part) {
		part.data = bytes;
		return;
	}
	pkg.contentTypes.overrides.push({
		partName: CORE_PROPS_PART_NAME,
		contentType: CORE_PROPS_CONTENT_TYPE
	});
	pkg.addPart(CORE_PROPS_PART_NAME, CORE_PROPS_CONTENT_TYPE, bytes);
	const rootRels = pkg.rootRels() ?? emptyRels();
	const rId = nextRelId(rootRels.items.map((r) => r.id));
	rootRels.items.push({
		id: rId,
		type: REL_TYPES.coreProperties,
		target: "docProps/core.xml",
		targetMode: "Internal"
	});
	pkg.setRootRels(rootRels);
};
const NS_EXT_PROPS = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
const EXT_PROPS_PART_NAME = partName("/docProps/app.xml");
/**
* Reads `/docProps/app.xml`. Returns `null` if the package has no
* extended-properties part. Each field is `null` when the
* corresponding element is absent or empty.
*/
const getExtendedProperties = (pres) => {
	const part = pres[INTERNAL_PACKAGE].getPart(EXT_PROPS_PART_NAME);
	if (!part) return null;
	const root = parseXml(decode$1(part.data)).root;
	const read = (local) => {
		const el = firstChildElement(root, qname("", local, NS_EXT_PROPS));
		if (!el) return null;
		let s = "";
		for (const c of el.children) if (c.kind === "text") s += c.data;
		return s.length === 0 ? null : s;
	};
	return {
		application: read("Application"),
		appVersion: read("AppVersion"),
		company: read("Company"),
		manager: read("Manager"),
		presentationFormat: read("PresentationFormat"),
		hyperlinkBase: read("HyperlinkBase")
	};
};
const EXT_PROP_FIELDS = [
	{
		key: "application",
		local: "Application"
	},
	{
		key: "appVersion",
		local: "AppVersion"
	},
	{
		key: "company",
		local: "Company"
	},
	{
		key: "manager",
		local: "Manager"
	},
	{
		key: "presentationFormat",
		local: "PresentationFormat"
	},
	{
		key: "hyperlinkBase",
		local: "HyperlinkBase"
	}
];
/**
* Writes selected fields on `/docProps/app.xml`. Throws when the
* package has no extended-properties part — unlike core-properties,
* we don't bootstrap app.xml from scratch because its schema
* requires several derived `<vt:*>` elements (`HeadingPairs`,
* `TitlesOfParts`, …) that aren't user-facing.
*
* Pass `null` to clear an existing field's text. Unspecified keys
* are left untouched.
*/
const setExtendedProperties = (pres, values) => {
	const part = pres[INTERNAL_PACKAGE].getPart(EXT_PROPS_PART_NAME);
	if (!part) throw new Error("setExtendedProperties: /docProps/app.xml not present; cannot bootstrap");
	const doc = parseXml(decode$1(part.data));
	for (const field of EXT_PROP_FIELDS) {
		if (!(field.key in values)) continue;
		const value = values[field.key] ?? null;
		const name = qname("", field.local, NS_EXT_PROPS);
		const existing = firstChildElement(doc.root, name);
		if (value === null) {
			if (existing) existing.children = [];
			continue;
		}
		if (existing) existing.children = [text(value)];
		else doc.root.children.push(elem(name, { children: [text(value)] }));
	}
	part.data = encode$1(serializeXml(doc));
};
//#endregion
//#region src/api/fn/thumbnail.ts
const findThumbnailRel = (pkg) => {
	const rootRels = pkg.rootRels();
	if (!rootRels) return null;
	const rel = rootRels.items.find((r) => r.type === REL_TYPES.thumbnail);
	if (!rel) return null;
	const target = rel.target;
	return {
		partName: target.startsWith("/") ? partName(target) : partName(`/${target}`),
		rId: rel.id
	};
};
/**
* Returns the package's thumbnail bytes, plus the detected image
* format. Returns `null` when the package has no thumbnail rel or
* the rel target part is missing.
*
* The returned `bytes` is a live view into the thumbnail part —
* treat it as read-only; copy if you need an independent buffer.
*/
const getThumbnail = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const hit = findThumbnailRel(pkg);
	if (!hit) return null;
	const part = pkg.getPart(hit.partName);
	if (!part) return null;
	const format = detectImageFormat(part.data);
	if (format === null) return null;
	return {
		format,
		bytes: part.data
	};
};
/**
* Replaces the package's thumbnail. Auto-detects the image format
* from the bytes (pass `options.format` to override). Bootstraps the
* thumbnail part + root rel + content-type default if the package
* had no thumbnail; otherwise replaces the existing thumbnail in
* place, switching its filename / extension if the format changed.
*/
const setThumbnail = (pres, bytes, options = {}) => {
	const format = options.format ?? detectImageFormat(bytes);
	if (format === null) throw new Error("setThumbnail: could not detect image format. Pass options.format explicitly.");
	const pkg = pres[INTERNAL_PACKAGE];
	const contentType = contentTypeForFormat(format);
	const extension = extensionForFormat(format);
	const desiredName = partName(`/docProps/thumbnail.${extension}`);
	const hit = findThumbnailRel(pkg);
	if (hit) {
		if (hit.partName === desiredName) {
			const part = pkg.getPart(hit.partName);
			if (!part) throw new Error(`thumbnail rel points at missing part ${hit.partName}`);
			part.data = bytes;
			part.contentType = contentType;
			setOpcDefault(pkg, extension, contentType);
			return;
		}
		pkg.removePart(hit.partName);
		pkg.addPart(desiredName, contentType, bytes);
		setOpcDefault(pkg, extension, contentType);
		const rootRels = pkg.rootRels() ?? emptyRels();
		const existing = rootRels.items.find((r) => r.id === hit.rId);
		if (existing) existing.target = `docProps/thumbnail.${extension}`;
		pkg.setRootRels(rootRels);
		return;
	}
	setOpcDefault(pkg, extension, contentType);
	pkg.addPart(desiredName, contentType, bytes);
	const rootRels = pkg.rootRels() ?? emptyRels();
	const rId = nextRelId(rootRels.items.map((r) => r.id));
	rootRels.items.push({
		id: rId,
		type: REL_TYPES.thumbnail,
		target: `docProps/thumbnail.${extension}`,
		targetMode: "Internal"
	});
	pkg.setRootRels(rootRels);
};
/**
* Removes the package's thumbnail entirely (drops the rel + the
* underlying part). No-op when the package has no thumbnail.
*/
const removeThumbnail = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const hit = findThumbnailRel(pkg);
	if (!hit) return;
	pkg.removePart(hit.partName);
	const rootRels = pkg.rootRels();
	if (!rootRels) return;
	rootRels.items = rootRels.items.filter((r) => r.id !== hit.rId);
	pkg.setRootRels(rootRels);
};
//#endregion
//#region src/api/fn/tables.ts
const NAME_A_GRAPHIC_TBL = qname("a", "graphic", NS.dml);
const NAME_A_GRAPHIC_DATA_TBL = qname("a", "graphicData", NS.dml);
const NAME_A_TBL = qname("a", "tbl", NS.dml);
const NAME_A_TC_PR = qname("a", "tcPr", NS.dml);
const NAME_A_TX_BODY_TBL = qname("a", "txBody", NS.dml);
const findTblElement = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "graphicFrame") return null;
	const graphic = firstChildElement(shape[SHAPE_ELEMENT], NAME_A_GRAPHIC_TBL);
	if (!graphic) return null;
	const graphicData = firstChildElement(graphic, NAME_A_GRAPHIC_DATA_TBL);
	if (!graphicData) return null;
	return firstChildElement(graphicData, NAME_A_TBL);
};
/**
* `true` when the shape is a `<p:graphicFrame>` wrapping `<a:tbl>` —
* i.e. a table. Sharper than `getShapeKind(shape) === 'graphicFrame'`,
* which also matches charts and SmartArt frames.
*/
const isTableShape = (shape) => findTblElement(shape) !== null;
/**
* Returns every table graphic-frame shape on the slide, in document
* order. Convenience over `getSlideShapes(slide).filter(isTableShape)`
* — pairs `getSlideCharts(slide)` for cases where the caller wants
* just the tables.
*/
const getSlideTables = (slide) => {
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) if (isTableShape(shape)) out.push(shape);
	return out;
};
/**
* Dense per-slide table count array. Counts `isTableShape` matches per
* slide. Rounds out the density-array family alongside the chart,
* shape, text, and comment counters.
*/
const getPresentationTableCountsBySlide = (pres) => getSlides(pres).map((s) => getSlideTables(s).length);
/**
* `true` when the shape is a `<p:graphicFrame>` wrapping a chart
* reference (`<c:chart>`). Charts, tables, and SmartArt all share
* the graphic-frame kind; this predicate filters down to charts only.
*/
const isChartShape = (shape) => resolveChartPartName(shape[SHAPE_SLIDE], shape) !== null;
const NAME_A_GRID_COL = qname("a", "gridCol", NS.dml);
const ATTR_W_TBL = qname("", "w", "");
const ATTR_H_TBL = qname("", "h", "");
const tableRows = (tbl) => tbl.children.filter((c) => c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "tr");
const rowCells = (tr) => tr.children.filter((c) => c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "tc");
const buildCellHandle = (table, tc, row, col) => ({
	[CELL_TABLE]: table,
	[CELL_ELEMENT]: tc,
	[CELL_ROW]: row,
	[CELL_COL]: col
});
/**
* Returns a 2D array of cell handles for the given table shape, in
* row-major order. Throws if the shape isn't a table graphic frame.
*/
const getTableCells = (table) => {
	const tbl = findTblElement(table);
	if (!tbl) throw new Error("getTableCells: shape is not a table graphic frame");
	return tableRows(tbl).map((tr, rowIdx) => rowCells(tr).map((tc, colIdx) => buildCellHandle(table, tc, rowIdx, colIdx)));
};
/**
* Reads the table-style GUID from `<a:tbl><a:tblPr><a:tableStyleId>`.
* PowerPoint uses GUIDs to reference built-in table styles
* (`{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}` = "Medium Style 2 -
* Accent 1", etc.) and theme-local styles. Returns `null` when the
* table doesn't reference one (uses the slide's default style).
*/
const getTableStyleId = (table) => {
	const tbl = findTblElement(table);
	if (!tbl) return null;
	const tblPr = firstChildElement(tbl, qname("a", "tblPr", NS.dml));
	if (!tblPr) return null;
	const idEl = firstChildElement(tblPr, qname("a", "tableStyleId", NS.dml));
	if (!idEl) return null;
	let acc = "";
	for (const c of idEl.children) if (c.kind === "text" || c.kind === "cdata") acc += c.data;
	return acc.trim() || null;
};
/**
* Writes `<a:tbl><a:tblPr><a:tableStyleId>` to the given GUID. Pass
* `null` to remove the element so the table falls back to the slide's
* default style. The GUID must include its curly braces — e.g.
* `'{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}'` (PowerPoint's "Medium
* Style 2 - Accent 1"). Creates `<a:tblPr>` if absent. Throws when the
* shape isn't a table graphic frame.
*/
const setTableStyleId = (table, styleId) => {
	const tbl = findTblElement(table);
	if (!tbl) throw new Error("setTableStyleId: shape is not a table graphic frame");
	const tblPr = ensureTblPr(tbl);
	tblPr.children = tblPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "tableStyleId"));
	if (styleId !== null) {
		const guid = normalizeGuid(styleId, "setTableStyleId: styleId");
		tblPr.children.push(elem(qname("a", "tableStyleId", NS.dml), { children: [text(guid)] }));
	}
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
/**
* Reads the boolean style flags off `<a:tblPr>` — which header /
* footer rows + columns are banded or emphasised. Mirrors the
* `firstRow` / `bandRow` flags exposed by `addSlideTable`.
*
* Per ECMA-376 §17.18.95 / §21.1.3.15:
*
*   - `firstRow` — header row is styled differently.
*   - `lastRow` — total row is styled differently.
*   - `firstCol` — first column is styled differently.
*   - `lastCol` — last column is styled differently.
*   - `bandRow` — alternating row shading.
*   - `bandCol` — alternating column shading.
*
* Renderers use these to switch on the corresponding table style
* variant. Returns all-`false` for tables that don't author `<a:tblPr>`.
*/
const getTableStyleFlags = (table) => {
	const empty = {
		firstRow: false,
		lastRow: false,
		firstCol: false,
		lastCol: false,
		bandRow: false,
		bandCol: false
	};
	const tbl = findTblElement(table);
	if (!tbl) return empty;
	const tblPr = firstChildElement(tbl, qname("a", "tblPr", NS.dml));
	if (!tblPr) return empty;
	const readBool = (attr) => {
		const v = getAttrValue(tblPr, qname("", attr, ""));
		return v === "1" || v === "true";
	};
	return {
		firstRow: readBool("firstRow"),
		lastRow: readBool("lastRow"),
		firstCol: readBool("firstCol"),
		lastCol: readBool("lastCol"),
		bandRow: readBool("bandRow"),
		bandCol: readBool("bandCol")
	};
};
const ensureTblPr = (tbl) => {
	let tblPr = firstChildElement(tbl, qname("a", "tblPr", NS.dml));
	if (tblPr === null) {
		tblPr = elem(qname("a", "tblPr", NS.dml));
		tbl.children.unshift(tblPr);
	}
	return tblPr;
};
const TABLE_STYLE_FLAG_KEYS = [
	"firstRow",
	"lastRow",
	"firstCol",
	"lastCol",
	"bandRow",
	"bandCol"
];
/**
* Sets one or more boolean style flags on `<a:tblPr>`. Only the keys
* present in `flags` are touched — omitted keys are left at their
* current state. A flag set to `false` strips the attribute (rather
* than emitting `="0"`), matching how PowerPoint round-trips defaults.
*
* See `getTableStyleFlags` for the meaning of each flag.
*/
const setTableStyleFlags = (table, flags) => {
	const tbl = findTblElement(table);
	if (!tbl) throw new Error("setTableStyleFlags: shape is not a table graphic frame");
	const tblPr = ensureTblPr(tbl);
	for (const key of TABLE_STYLE_FLAG_KEYS) {
		const v = flags[key];
		if (v === void 0) continue;
		tblPr.attrs = tblPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === key));
		if (v) tblPr.attrs.push(attr(qname("", key, ""), "1"));
	}
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
/**
* Returns the table's row + column counts. Throws when the shape
* isn't a table graphic frame.
*/
const getTableDimensions = (table) => {
	const tbl = findTblElement(table);
	if (!tbl) throw new Error("getTableDimensions: shape is not a table graphic frame");
	const rows = tableRows(tbl);
	const cols = rows[0] !== void 0 ? rowCells(rows[0]).length : 0;
	return {
		rows: rows.length,
		cols
	};
};
/**
* Returns each column's width in EMU, in left-to-right order, as
* declared on `<a:tblGrid>/<a:gridCol w="...">`. Missing or
* unparseable widths default to 0. Throws when the shape isn't a
* table graphic frame.
*/
const getTableColumnWidths = (table) => {
	const tbl = findTblElement(table);
	if (!tbl) throw new Error("getTableColumnWidths: shape is not a table graphic frame");
	const grid = firstChildElement(tbl, qname("a", "tblGrid", NS.dml));
	if (!grid) return [];
	const out = [];
	for (const col of allChildElements(grid, NAME_A_GRID_COL)) {
		const v = getAttrValue(col, ATTR_W_TBL);
		const n = v !== null ? Number.parseInt(v, 10) : 0;
		out.push(Number.isFinite(n) ? n : 0);
	}
	return out;
};
/**
* Returns the table's nominal `(width, height)` derived from
* summing the `<a:gridCol w>` and `<a:tr h>` attributes (both in
* EMU). Useful for layout pipelines that want to know how big a
* table really is without dereferencing the shape's `<a:xfrm>`.
*
* Throws when the shape isn't a table graphic frame.
*/
const getTableSize = (table) => {
	const widths = getTableColumnWidths(table);
	const heights = getTableRowHeights(table);
	return {
		width: widths.reduce((sum, w) => sum + w, 0),
		height: heights.reduce((sum, h) => sum + h, 0)
	};
};
/**
* Returns each row's height in EMU, in top-to-bottom order, from
* `<a:tr h="...">`. Missing or unparseable heights default to 0.
* Throws when the shape isn't a table graphic frame.
*/
const getTableRowHeights = (table) => {
	const tbl = findTblElement(table);
	if (!tbl) throw new Error("getTableRowHeights: shape is not a table graphic frame");
	const out = [];
	for (const tr of tableRows(tbl)) {
		const v = getAttrValue(tr, ATTR_H_TBL);
		const n = v !== null ? Number.parseInt(v, 10) : 0;
		out.push(Number.isFinite(n) ? n : 0);
	}
	return out;
};
/**
* Sets a single column's width on the table grid. Throws on
* out-of-range column indices or non-table shapes. The total table
* width is not auto-adjusted — callers are responsible for keeping
* the sum consistent with the table's `<a:xfrm>` extent if PowerPoint
* is to render the table without clipping.
*/
const setTableColumnWidth = (table, col, width) => {
	const grid = firstChildElement(requireTbl(table), qname("a", "tblGrid", NS.dml));
	if (!grid) throw new Error("table has no <a:tblGrid>");
	const cols = allChildElements(grid, NAME_A_GRID_COL);
	const target = cols[col];
	if (!target) throw new RangeError(`table column ${col} out of range (have ${cols.length})`);
	target.attrs = target.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "w"));
	target.attrs.push(attr(ATTR_W_TBL, String(emuExtent(width, "setTableColumnWidth: width"))));
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
/**
* Sets a single row's height. Throws on out-of-range row indices or
* non-table shapes. As with `setTableColumnWidth`, the table's
* `<a:xfrm>` extent is left to the caller.
*/
const setTableRowHeight = (table, row, height) => {
	const rows = tableRows(requireTbl(table));
	const target = rows[row];
	if (!target) throw new RangeError(`table row ${row} out of range (have ${rows.length})`);
	target.attrs = target.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "h"));
	target.attrs.push(attr(ATTR_H_TBL, String(emuExtent(height, "setTableRowHeight: height"))));
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
/**
* Returns the cell at `(row, col)`. Throws on out-of-range coordinates
* or non-table shapes.
*/
const getTableCell = (table, row, col) => {
	const cells = getTableCells(table);
	const r = cells[row];
	if (!r) throw new RangeError(`table row ${row} out of range (have ${cells.length})`);
	const c = r[col];
	if (!c) throw new RangeError(`table column ${col} out of range in row ${row} (have ${r.length})`);
	return c;
};
const commitTableCell = (cell) => {
	const shape = cell[CELL_TABLE];
	commitSlideData(shape[SHAPE_SLIDE]);
	refreshSlideData(shape[SHAPE_SLIDE]);
};
const ensureCellTxBody = (cell) => {
	const tc = cell[CELL_ELEMENT];
	let txBody = firstChildElement(tc, NAME_A_TX_BODY_TBL);
	if (txBody === null) {
		txBody = elem(NAME_A_TX_BODY_TBL);
		txBody.children.push(elem(qname("a", "bodyPr", NS.dml)));
		txBody.children.push(elem(qname("a", "lstStyle", NS.dml)));
		txBody.children.push(elem(qname("a", "p", NS.dml)));
		tc.children.unshift(txBody);
	}
	return txBody;
};
const ensureCellTcPr = (cell) => {
	const tc = cell[CELL_ELEMENT];
	let tcPr = firstChildElement(tc, NAME_A_TC_PR);
	if (tcPr === null) {
		tcPr = elem(NAME_A_TC_PR);
		tc.children.push(tcPr);
	}
	return tcPr;
};
/**
* Replaces a cell's text. `\n` starts a new paragraph. The paragraph-end
* format (`<a:endParaRPr>`) is not kept; author it with `setTableCellParagraphs`.
*/
const setTableCellText = (cell, text) => {
	setTextBody(ensureCellTxBody(cell), text);
	commitTableCell(cell);
};
/**
* Replaces the cell's text with explicitly structured paragraphs and runs —
* the table counterpart of `setShapeParagraphs`. Read back with
* `getTableCellParagraphs`.
*/
const setTableCellParagraphs = (cell, paragraphs) => {
	const built = buildTextBodyParagraphs(paragraphs, "setTableCellParagraphs");
	replaceTextBodyParagraphs(ensureCellTxBody(cell), built);
	commitTableCell(cell);
};
/**
* Reads the cell's merge / span attributes:
*
*   - `gridSpan` — number of columns this cell spans (≥1, default 1).
*   - `rowSpan` — number of rows this cell spans (≥1, default 1).
*   - `hMerge` — `true` when this cell is the right half of a horizontal
*     span (it's painted by an earlier cell with `gridSpan > 1`).
*   - `vMerge` — `true` when this cell is the bottom half of a vertical
*     span (it's painted by an earlier cell with `rowSpan > 1`).
*
* Renderers should skip painting cells where `hMerge` or `vMerge` is
* true; those cells exist only so the row/column grid stays consistent.
*/
const getTableCellSpan = (cell) => {
	const el = cell[CELL_ELEMENT];
	const gs = getAttrValue(el, qname("", "gridSpan", ""));
	const rs = getAttrValue(el, qname("", "rowSpan", ""));
	const hm = getAttrValue(el, qname("", "hMerge", ""));
	const vm = getAttrValue(el, qname("", "vMerge", ""));
	const parseSpan = (v) => {
		if (v === null) return 1;
		const n = Number.parseInt(v, 10);
		return Number.isFinite(n) && n > 0 ? n : 1;
	};
	return {
		gridSpan: parseSpan(gs),
		rowSpan: parseSpan(rs),
		hMerge: hm === "1" || hm === "true",
		vMerge: vm === "1" || vm === "true"
	};
};
const ATTR_GRID_SPAN = qname("", "gridSpan", "");
const ATTR_ROW_SPAN = qname("", "rowSpan", "");
const ATTR_H_MERGE = qname("", "hMerge", "");
const ATTR_V_MERGE = qname("", "vMerge", "");
const setSpanAttr = (tc, name, value) => {
	tc.attrs = tc.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === name.localName));
	tc.attrs.push(attr(name, value));
};
/** A cell already carries a merge marker / multi-cell span. */
const cellIsMergedAlready = (tc) => {
	const gs = getAttrValue(tc, ATTR_GRID_SPAN);
	const rs = getAttrValue(tc, ATTR_ROW_SPAN);
	const hm = getAttrValue(tc, ATTR_H_MERGE);
	const vm = getAttrValue(tc, ATTR_V_MERGE);
	return gs !== null && Number.parseInt(gs, 10) > 1 || rs !== null && Number.parseInt(rs, 10) > 1 || hm === "1" || hm === "true" || vm === "1" || vm === "true";
};
/**
* Merges a rectangular block of table cells into a single visual cell.
*
* The block's top-left cell `(row, col)` becomes the anchor and carries
* `gridSpan` (= `colSpan`) / `rowSpan`; the cells it covers are marked
* `hMerge` / `vMerge` per ECMA-376 §21.1.3.18 (`CT_TableCell`) so the
* grid stays rectangular while PowerPoint paints only the anchor. This
* is the write counterpart to {@link getTableCellSpan}.
*
* Constraints, enforced loudly (these are authoring-boundary inputs):
*
*   - `rowSpan` / `colSpan` must be ≥ 1, and at least one must be > 1
*     (a 1×1 "merge" is a no-op the caller didn't mean).
*   - The block must lie fully inside the table grid.
*   - No cell in the block may already participate in another merge —
*     overlapping merges corrupt the grid and trip PowerPoint's repair
*     dialog. Split the existing merge first.
*
* The anchor cell's text is preserved. `coveredText: 'keep'` (the default)
* leaves each covered cell's `<a:txBody>` in the XML; `'drop'` removes it,
* so the covered cells carry no `<a:txBody>` at all (CT_TableCell allows
* that), which is how PptxGenJS writes a merge; `getTableCellParagraphs`
* reads them as `[]`.
*/
const mergeTableCells = (table, block, options) => {
	const { row, col, rowSpan, colSpan } = block;
	const coveredText = options?.coveredText ?? "keep";
	if (coveredText !== "keep" && coveredText !== "drop") throw new TypeError(`mergeTableCells: coveredText must be 'keep' or 'drop' (got ${String(coveredText)})`);
	if (!Number.isInteger(rowSpan) || !Number.isInteger(colSpan) || rowSpan < 1 || colSpan < 1) throw new RangeError(`mergeTableCells: rowSpan / colSpan must be integers ≥ 1 (got ${rowSpan} × ${colSpan})`);
	if (rowSpan === 1 && colSpan === 1) throw new RangeError("mergeTableCells: a 1×1 block is not a merge");
	if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) throw new RangeError(`mergeTableCells: row / col must be non-negative integers (got ${row}, ${col})`);
	const cells = getTableCells(table);
	const lastRow = row + rowSpan - 1;
	const lastCol = col + colSpan - 1;
	if (lastRow >= cells.length) throw new RangeError(`mergeTableCells: block rows ${row}..${lastRow} exceed table height ${cells.length}`);
	for (let r = row; r <= lastRow; r++) {
		const rowCellsArr = cells[r];
		if (lastCol >= rowCellsArr.length) throw new RangeError(`mergeTableCells: block cols ${col}..${lastCol} exceed row ${r} width ${rowCellsArr.length}`);
	}
	for (let r = row; r <= lastRow; r++) for (let c = col; c <= lastCol; c++) if (cellIsMergedAlready(cells[r][c][CELL_ELEMENT])) throw new Error(`mergeTableCells: cell (${r}, ${c}) is already part of a merge; split it before re-merging`);
	for (let r = row; r <= lastRow; r++) for (let c = col; c <= lastCol; c++) {
		const tc = cells[r][c][CELL_ELEMENT];
		if (r === row && c === col) {
			if (colSpan > 1) setSpanAttr(tc, ATTR_GRID_SPAN, String(colSpan));
			if (rowSpan > 1) setSpanAttr(tc, ATTR_ROW_SPAN, String(rowSpan));
			continue;
		}
		if (c > col) setSpanAttr(tc, ATTR_H_MERGE, "1");
		if (r > row) setSpanAttr(tc, ATTR_V_MERGE, "1");
		if (coveredText === "drop") tc.children = tc.children.filter((child) => !(child.kind === "element" && qnameEquals(child.name, NAME_A_TX_BODY_TBL)));
	}
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
/**
* Reads the per-side borders on a cell. Returns `null` for sides with
* no explicit `<a:ln{Side}>` element (those inherit from the table
* style / theme). All four cardinal sides plus the two diagonals
* (TL→BR, BL→TR) are surfaced because real templates use them all.
*/
const getTableCellBorders = (pres, cell) => {
	const tcPr = firstChildElement(cell[CELL_ELEMENT], NAME_A_TC_PR);
	const theme = getPresentationTheme(pres);
	const empty = {
		left: null,
		right: null,
		top: null,
		bottom: null,
		tlToBr: null,
		blToTr: null
	};
	if (!tcPr) return empty;
	const readLn = (local) => {
		const ln = firstChildElement(tcPr, qname("a", local, NS.dml));
		if (!ln) return null;
		const w = getAttrValue(ln, qname("", "w", ""));
		const widthEmu = w !== null ? Number.parseInt(w, 10) : null;
		let color = null;
		const solid = firstChildElement(ln, qname("a", "solidFill", NS.dml));
		if (solid) for (const c of solid.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			color = resolveDrawingColor(c, theme);
			break;
		}
		const prstDash = firstChildElement(ln, qname("a", "prstDash", NS.dml));
		const dash = prstDash ? getAttrValue(prstDash, qname("", "val", "")) : null;
		return {
			color,
			widthEmu,
			dash
		};
	};
	return {
		left: readLn("lnL"),
		right: readLn("lnR"),
		top: readLn("lnT"),
		bottom: readLn("lnB"),
		tlToBr: readLn("lnTlToBr"),
		blToTr: readLn("lnBlToTr")
	};
};
const BORDER_SIDE_LOCALS = {
	left: "lnL",
	right: "lnR",
	top: "lnT",
	bottom: "lnB",
	tlToBr: "lnTlToBr",
	blToTr: "lnBlToTr"
};
const TCPR_CHILD_RANK = {
	lnL: 0,
	lnR: 1,
	lnT: 2,
	lnB: 3,
	lnTlToBr: 4,
	lnBlToTr: 5,
	cell3D: 6,
	noFill: 7,
	solidFill: 7,
	gradFill: 7,
	blipFill: 7,
	pattFill: 7,
	grpFill: 7,
	headers: 8,
	extLst: 9
};
const tcPrChildRank = (el) => el.name.namespaceURI === NS.dml ? TCPR_CHILD_RANK[el.name.localName] ?? 99 : 99;
const writeBorderLn = (tcPr, local, border) => {
	tcPr.children = tcPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === local));
	if (border === null) return;
	const lnAttrs = [];
	if (border.widthEmu !== null && border.widthEmu !== void 0) {
		const w = lineWidthEmu(border.widthEmu, "setTableCellBorders: widthEmu");
		lnAttrs.push(attr(qname("", "w", ""), String(w)));
	}
	const children = [];
	if (border.color !== null && border.color !== void 0) children.push(elem(qname("a", "solidFill", NS.dml), { children: [buildColorElement(border.color)] }));
	if (border.dash !== null && border.dash !== void 0) children.push(elem(qname("a", "prstDash", NS.dml), { attrs: [attr(qname("", "val", ""), border.dash)] }));
	insertChildByRank(tcPr, elem(qname("a", local, NS.dml), {
		attrs: lnAttrs,
		children
	}), tcPrChildRank);
};
/**
* Sets one or more side borders on a cell. Sides listed with `null` are
* removed from the `<a:tcPr>`; sides omitted from the partial are left
* untouched. Pass the whole `sides` arg as `null` to clear every side
* in one call. Creates `<a:tcPr>` if absent.
*
* The diagonal sides (`tlToBr` / `blToTr`) are independent of the
* cardinal four — a strikethrough cell can have only a diagonal.
*/
const setTableCellBorders = (cell, sides) => {
	if (sides !== null) {
		for (const [side, border] of Object.entries(sides)) if (border?.dash != null) oneOf(border.dash, LINE_DASHES, `setTableCellBorders: ${side}.dash`);
	}
	const tcPr = ensureCellTcPr(cell);
	if (sides === null) for (const local of Object.values(BORDER_SIDE_LOCALS)) writeBorderLn(tcPr, local, null);
	else for (const [key, local] of Object.entries(BORDER_SIDE_LOCALS)) {
		const v = sides[key];
		if (v === void 0) continue;
		writeBorderLn(tcPr, local, v);
	}
	commitTableCell(cell);
};
/**
* Reads the cell's text direction (`<a:tcPr vert="…"/>`) — same tokens
* as `getShapeTextDirection`. Returns `null` for the default
* horizontal direction.
*
* Vertical column headers in tables almost always emit `<a:tcPr
* vert="vert270"/>` or `"eaVert"` so the header label reads bottom-to-
* top alongside its column.
*/
const getTableCellTextDirection = (cell) => {
	const tcPr = firstChildElement(cell[CELL_ELEMENT], NAME_A_TC_PR);
	if (!tcPr) return null;
	const v = getAttrValue(tcPr, qname("", "vert", ""));
	if (v === "vert" || v === "vert270" || v === "wordArtVert" || v === "eaVert" || v === "mongolianVert" || v === "wordArtVertRtl") return v;
	return null;
};
/**
* Sets the cell's text-direction via `<a:tcPr vert="…"/>`. Same six
* `ST_TextVerticalType` values as `setShapeTextDirection`. Passing
* `null` (or `'horz'`) clears the attribute so the cell uses the
* default horizontal direction. Creates `<a:tcPr>` if absent.
*/
const setTableCellTextDirection = (cell, direction) => {
	if (direction !== null) oneOf(direction, TEXT_DIRECTIONS, "setTableCellTextDirection: direction");
	const tcPr = ensureCellTcPr(cell);
	tcPr.attrs = tcPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "vert"));
	if (direction !== null && direction !== "horz") tcPr.attrs.push(attr(qname("", "vert", ""), direction));
	commitTableCell(cell);
};
/**
* Reads the cell's vertical text anchor (`<a:tcPr anchor="t|ctr|b"/>`)
* — `'top'`, `'center'`, `'bottom'`, or `null` for the default
* (`ctr` / center per the schema).
*/
const getTableCellAnchor = (cell) => {
	const tcPr = firstChildElement(cell[CELL_ELEMENT], NAME_A_TC_PR);
	if (!tcPr) return null;
	const v = getAttrValue(tcPr, qname("", "anchor", ""));
	if (v === "t") return "top";
	if (v === "ctr") return "center";
	if (v === "b") return "bottom";
	return null;
};
/**
* Sets the cell's vertical text anchor (`<a:tcPr anchor="t|ctr|b"/>`).
* Pass `null` to clear the attribute so the cell uses the table's
* default (`ctr`). Creates `<a:tcPr>` if absent.
*/
const setTableCellAnchor = (cell, anchor) => {
	if (anchor !== null) oneOf(anchor, [
		"top",
		"center",
		"bottom"
	], "setTableCellAnchor: anchor");
	const tcPr = ensureCellTcPr(cell);
	tcPr.attrs = tcPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "anchor"));
	if (anchor !== null) {
		const mapped = TEXT_ANCHORS[anchor];
		tcPr.attrs.push(attr(qname("", "anchor", ""), mapped));
	}
	commitTableCell(cell);
};
/**
* Reads the cell's inset margins (`<a:tcPr marL marR marT marB>`) in
* EMU. Each side is `null` when the cell doesn't author it (renderers
* should fall back to PowerPoint's defaults — 91440 EMU / 0.1 inch
* for the horizontal margins, 45720 EMU for the vertical).
*/
const getTableCellMargins = (cell) => {
	const tcPr = firstChildElement(cell[CELL_ELEMENT], NAME_A_TC_PR);
	const empty = {
		left: null,
		right: null,
		top: null,
		bottom: null
	};
	if (!tcPr) return empty;
	const read = (name) => {
		const v = getAttrValue(tcPr, qname("", name, ""));
		if (v === null) return null;
		const n = Number.parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	};
	return {
		left: read("marL"),
		right: read("marR"),
		top: read("marT"),
		bottom: read("marB")
	};
};
/**
* Sets the cell's inset margins (`<a:tcPr marL marR marT marB>`) in
* EMU. Sides set to `null` are stripped from the XML so they fall back
* to PowerPoint's defaults. Creates `<a:tcPr>` if absent.
*
* Pass `null` for the whole `margins` arg to drop every authored side
* at once.
*/
const setTableCellMargins = (cell, margins) => {
	const tcPr = ensureCellTcPr(cell);
	const MAR_ATTRS = new Set([
		"marL",
		"marR",
		"marT",
		"marB"
	]);
	tcPr.attrs = tcPr.attrs.filter((a) => !(a.name.namespaceURI === "" && MAR_ATTRS.has(a.name.localName)));
	if (margins !== null) {
		const pairs = [
			["marL", margins.left],
			["marR", margins.right],
			["marT", margins.top],
			["marB", margins.bottom]
		];
		for (const [name, val] of pairs) if (val !== null && val !== void 0) {
			const emu = emuCoordinate32(val, `setTableCellMargins: ${name}`);
			tcPr.attrs.push(attr(qname("", name, ""), String(emu)));
		}
	}
	commitTableCell(cell);
};
/** Reads the cell's plain text (paragraphs joined with `\n`). */
const getTableCellText = (cell) => {
	const txBody = firstChildElement(cell[CELL_ELEMENT], NAME_A_TX_BODY_TBL);
	if (!txBody) return "";
	const lines = [];
	for (const p of txBody.children) {
		if (p.kind !== "element" || p.name.namespaceURI !== NS.dml || p.name.localName !== "p") continue;
		let line = "";
		for (const r of p.children) {
			if (r.kind !== "element" || r.name.namespaceURI !== NS.dml || r.name.localName !== "r") continue;
			const tEl = firstChildElement(r, qname("a", "t", NS.dml));
			if (!tEl) continue;
			for (const child of tEl.children) if (child.kind === "text" || child.kind === "cdata") line += child.data;
		}
		lines.push(line);
	}
	return lines.join("\n");
};
/**
* Reads a cell's text as structured paragraphs — each carrying its
* alignment and per-run format (`size`, `bold`, `italic`, `color`,
* `font`, …) — for renderers that need to reproduce styled cell text.
* `getTableCellText` is the flat-string counterpart when only the visible
* characters matter. Returns an empty array when the cell has no
* `<a:txBody>`.
*
* The cell's `<a:txBody>` uses the same DrawingML paragraph grammar as a
* shape's, so this shares `readParagraphElements` with
* `getShapeParagraphElements`. Table-style and theme-level defaults are not
* folded in here: explicit run properties win, and absent ones are left
* `undefined` for the caller to resolve.
*/
const getTableCellParagraphs = (cell) => {
	const txBody = firstChildElement(cell[CELL_ELEMENT], NAME_A_TX_BODY_TBL);
	if (!txBody) return [];
	const out = [];
	for (const p of txBody.children) {
		if (p.kind !== "element" || p.name.namespaceURI !== NS.dml || p.name.localName !== "p") continue;
		const pPr = firstChildElement(p, qname("a", "pPr", NS.dml));
		const algn = pPr ? getAttrValue(pPr, qname("", "algn", "")) : null;
		const align = algn !== null ? ALIGN_TOKEN_MAP[algn] ?? null : null;
		out.push({
			align,
			elements: readParagraphElements(p),
			endFormat: readParagraphEndFormat(p)
		});
	}
	return out;
};
/** Sets a solid background color on a cell (`<a:tcPr><a:solidFill>`). */
const setTableCellFill = (cell, color) => {
	setSolidFill(ensureCellTcPr(cell), color);
	commitTableCell(cell);
};
/** Removes any background fill from a cell. */
const clearTableCellFill = (cell) => {
	clearFill(ensureCellTcPr(cell));
	commitTableCell(cell);
};
/**
* Reads the cell's solid background color. Returns `#RRGGBB` for
* `<a:srgbClr>`, `scheme:<token>` for `<a:schemeClr>`, or `null` when
* the cell has no fill, no `<a:tcPr>`, or the fill is non-solid
* (gradient / pattern / image).
*/
const getTableCellFill = (cell) => {
	const tcPr = firstChildElement(cell[CELL_ELEMENT], NAME_A_TC_PR);
	if (!tcPr) return null;
	const solid = firstChildElement(tcPr, qname("a", "solidFill", NS.dml));
	if (!solid) return null;
	const srgb = firstChildElement(solid, qname("a", "srgbClr", NS.dml));
	if (srgb) {
		const v = getAttrValue(srgb, qname("", "val", ""));
		if (v) return `#${v.toUpperCase()}`;
	}
	const scheme = firstChildElement(solid, qname("a", "schemeClr", NS.dml));
	if (scheme) {
		const v = getAttrValue(scheme, qname("", "val", ""));
		if (v) return `scheme:${v}`;
	}
	return null;
};
/** Applies a TextFormat to every run in the cell's text. */
const setTableCellTextFormat = (cell, format) => {
	validateFormatEnums(format, "setTableCellTextFormat");
	applyValidatedFormatToAllRuns(ensureCellTxBody(cell), format);
	commitTableCell(cell);
};
/** Sets horizontal alignment on every paragraph in the cell. */
const setTableCellAlignment = (cell, align) => {
	const token = alignToken(align, "setTableCellAlignment");
	applyAlignmentTokenToAllParagraphs(ensureCellTxBody(cell), token);
	commitTableCell(cell);
};
/** Zero-based (row, col) of the cell. */
const getTableCellPosition = (cell) => ({
	row: cell[CELL_ROW],
	col: cell[CELL_COL]
});
/**
* Reads the horizontal alignment from the cell's first paragraph as its
* spec token (`l`, `ctr`, `r`, `just`, `dist`, `justLow`, `thaiDist`) — so
* `setTableCellAlignment(cell, 'center')` reads back as `'ctr'`. Returns
* `null` when the cell has no `<a:txBody>`, or its first paragraph has no
* valid `algn` attribute (PowerPoint then defaults to `l`). For a
* plain-English name per paragraph, use `getTableCellParagraphs`.
*/
const getTableCellAlignment = (cell) => {
	const txBody = firstChildElement(cell[CELL_ELEMENT], NAME_A_TX_BODY_TBL);
	if (!txBody) return null;
	for (const p of txBody.children) {
		if (p.kind !== "element" || p.name.namespaceURI !== NS.dml || p.name.localName !== "p") continue;
		const pPr = firstChildElement(p, qname("a", "pPr", NS.dml));
		if (!pPr) return null;
		return parseAlignmentToken(getAttrValue(pPr, qname("", "algn", "")));
	}
	return null;
};
const requireTbl = (table) => {
	const tbl = findTblElement(table);
	if (!tbl) throw new Error("table shape is not a table graphic frame");
	return tbl;
};
const tableColumnCount = (tbl) => {
	const grid = firstChildElement(tbl, qname("a", "tblGrid", NS.dml));
	if (!grid) return 0;
	return allChildElements(grid, NAME_A_GRID_COL).length;
};
const rowDefaultHeight = (tbl) => {
	const rows = tableRows(tbl);
	if (rows.length === 0) return 37e4;
	let sum = 0;
	let count = 0;
	for (const r of rows) {
		const h = getAttrValue(r, ATTR_H_TBL);
		if (h !== null) {
			const n = Number.parseInt(h, 10);
			if (Number.isFinite(n)) {
				sum += n;
				count++;
			}
		}
	}
	return count > 0 ? Math.round(sum / count) : 37e4;
};
/**
* Inserts a row into the table. `atIndex` is 0-based; `undefined`
* appends at the end. `cells` supplies cell values; missing cells
* become blank, extras are dropped. The row's height matches the
* average of existing rows (or a 0.4in default for empty tables).
*/
const insertTableRow = (table, atIndex, cells = []) => {
	const tbl = requireTbl(table);
	const colCount = tableColumnCount(tbl);
	const padded = [];
	for (let i = 0; i < colCount; i++) padded.push(cells[i] ?? "");
	const row = buildTableRow(padded, rowDefaultHeight(tbl));
	const rows = tableRows(tbl);
	const insertAt = atIndex !== void 0 ? Math.max(0, Math.min(atIndex, rows.length)) : rows.length;
	if (insertAt === rows.length) tbl.children.push(row);
	else {
		const target = rows[insertAt];
		const idx = tbl.children.indexOf(target);
		tbl.children.splice(idx, 0, row);
	}
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
/** Removes the row at `atIndex` from the table. Throws on out-of-range. */
const removeTableRow = (table, atIndex) => {
	const tbl = requireTbl(table);
	const rows = tableRows(tbl);
	if (atIndex < 0 || atIndex >= rows.length) throw new RangeError(`removeTableRow: index ${atIndex} out of range (have ${rows.length})`);
	const target = rows[atIndex];
	tbl.children = tbl.children.filter((c) => c !== target);
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
/**
* Inserts a column into the table. `atIndex` defaults to the end.
* `widthEmu` defaults to the average of existing column widths (or
* 914400 = 1in if the table has no columns). Existing rows get a new
* blank cell at `atIndex`.
*/
const insertTableColumn = (table, atIndex, widthEmu) => {
	const tbl = requireTbl(table);
	const grid = firstChildElement(tbl, qname("a", "tblGrid", NS.dml));
	if (!grid) throw new Error("table is missing <a:tblGrid>");
	const cols = allChildElements(grid, NAME_A_GRID_COL);
	const insertAt = atIndex !== void 0 ? Math.max(0, Math.min(atIndex, cols.length)) : cols.length;
	let defaultWidth = widthEmu;
	if (defaultWidth === void 0) {
		let sum = 0;
		let count = 0;
		for (const col of cols) {
			const w = getAttrValue(col, ATTR_W_TBL);
			if (w !== null) {
				const n = Number.parseInt(w, 10);
				if (Number.isFinite(n)) {
					sum += n;
					count++;
				}
			}
		}
		defaultWidth = count > 0 ? Math.round(sum / count) : 914400;
	}
	const newCol = elem(NAME_A_GRID_COL, { attrs: [attr(ATTR_W_TBL, String(defaultWidth))] });
	if (insertAt === cols.length) grid.children.push(newCol);
	else {
		const target = cols[insertAt];
		const idx = grid.children.indexOf(target);
		grid.children.splice(idx, 0, newCol);
	}
	for (const tr of tableRows(tbl)) {
		const tcs = rowCells(tr);
		const newCell = buildTableCell("");
		if (insertAt >= tcs.length) tr.children.push(newCell);
		else {
			const target = tcs[insertAt];
			const idx = tr.children.indexOf(target);
			tr.children.splice(idx, 0, newCell);
		}
	}
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
/** Removes the column at `atIndex` (and the corresponding cell in every row). */
const removeTableColumn = (table, atIndex) => {
	const tbl = requireTbl(table);
	const grid = firstChildElement(tbl, qname("a", "tblGrid", NS.dml));
	if (!grid) throw new Error("table is missing <a:tblGrid>");
	const cols = allChildElements(grid, NAME_A_GRID_COL);
	if (atIndex < 0 || atIndex >= cols.length) throw new RangeError(`removeTableColumn: index ${atIndex} out of range (have ${cols.length})`);
	const targetCol = cols[atIndex];
	grid.children = grid.children.filter((c) => c !== targetCol);
	for (const tr of tableRows(tbl)) {
		const tcs = rowCells(tr);
		if (atIndex < tcs.length) tr.children = tr.children.filter((c) => c !== tcs[atIndex]);
	}
	commitSlideData(table[SHAPE_SLIDE]);
	refreshSlideData(table[SHAPE_SLIDE]);
};
//#endregion
//#region src/internal/validator/validate-presentation.ts
const PRES_PART = partName("/ppt/presentation.xml");
const PRES_RELS = partName("/ppt/_rels/presentation.xml.rels");
const NAME_SLD_ID_LST = qname("p", "sldIdLst", NS.pml);
const NAME_SLD_ID = qname("p", "sldId", NS.pml);
const ATTR_ID$1 = qname("", "id", "");
const ATTR_R_ID = qname("r", "id", NS.officeDocRels);
const decoder = new TextDecoder();
const decode = (b) => decoder.decode(b);
const targetPartName = (sourcePart, rel) => rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(sourcePart, rel.target);
/**
* Runs every invariant check in this module against `pkg`. Returns a
* list of issues; an empty list means the deck passes every check. The
* function never throws — callers decide how to surface issues (some
* may treat warnings as informational, others may want a strict gate).
*/
const validatePresentationPackage = (pkg) => {
	const issues = [];
	const presPart = pkg.getPart(PRES_PART);
	if (!presPart) {
		issues.push({
			severity: "error",
			message: "/ppt/presentation.xml is missing",
			partName: PRES_PART
		});
		return issues;
	}
	const presRels = pkg.getRels(PRES_PART);
	if (!presRels) {
		issues.push({
			severity: "error",
			message: "/ppt/presentation.xml has no .rels part",
			partName: PRES_RELS
		});
		return issues;
	}
	let presDocRoot;
	try {
		presDocRoot = parseXml(decode(presPart.data)).root;
	} catch (e) {
		issues.push({
			severity: "error",
			message: `presentation.xml failed to parse: ${e.message}`,
			partName: PRES_PART
		});
		return issues;
	}
	const sldIdLst = firstChildElement(presDocRoot, NAME_SLD_ID_LST);
	const seenIds = /* @__PURE__ */ new Set();
	const seenRIds = /* @__PURE__ */ new Set();
	const slidePartNames = [];
	if (sldIdLst !== null) for (const sldId of allChildElements(sldIdLst, NAME_SLD_ID)) {
		const idRaw = getAttrValue(sldId, ATTR_ID$1);
		const rIdRaw = getAttrValue(sldId, ATTR_R_ID);
		if (idRaw === null) {
			issues.push({
				severity: "error",
				message: "<p:sldId> missing id attribute",
				partName: PRES_PART
			});
			continue;
		}
		if (rIdRaw === null) {
			issues.push({
				severity: "error",
				message: `<p:sldId id="${idRaw}"> missing r:id`,
				partName: PRES_PART
			});
			continue;
		}
		if (seenIds.has(idRaw)) issues.push({
			severity: "error",
			message: `duplicate <p:sldId id="${idRaw}">`,
			partName: PRES_PART
		});
		else seenIds.add(idRaw);
		if (seenRIds.has(rIdRaw)) issues.push({
			severity: "error",
			message: `duplicate r:id="${rIdRaw}" in <p:sldIdLst>`,
			partName: PRES_PART
		});
		else seenRIds.add(rIdRaw);
		const rel = presRels.items.find((r) => r.id === rIdRaw);
		if (!rel) {
			issues.push({
				severity: "error",
				message: `<p:sldId r:id="${rIdRaw}"> has no matching rel`,
				partName: PRES_PART
			});
			continue;
		}
		const slidePartName = targetPartName(PRES_PART, rel);
		if (pkg.getPart(slidePartName) === null) {
			issues.push({
				severity: "error",
				message: `slide rel target ${slidePartName} not in package`,
				partName: slidePartName
			});
			continue;
		}
		slidePartNames.push(slidePartName);
	}
	for (const slideName of slidePartNames) {
		const slideRels = pkg.getRels(slideName);
		if (!slideRels) {
			issues.push({
				severity: "warning",
				message: `slide ${slideName} has no .rels part`,
				partName: slideName
			});
			continue;
		}
		const layoutRel = slideRels.items.find((r) => r.type === REL_TYPES.slideLayout);
		if (!layoutRel) {
			issues.push({
				severity: "error",
				message: `slide ${slideName} is missing a slideLayout rel`,
				partName: slideName
			});
			continue;
		}
		const layoutName = targetPartName(slideName, layoutRel);
		if (pkg.getPart(layoutName) === null) {
			issues.push({
				severity: "error",
				message: `slide ${slideName} references missing layout ${layoutName}`,
				partName: slideName
			});
			continue;
		}
		const layoutRels = pkg.getRels(layoutName);
		if (!layoutRels) {
			issues.push({
				severity: "warning",
				message: `slide layout ${layoutName} has no .rels part`,
				partName: layoutName
			});
			continue;
		}
		const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
		if (!masterRel) {
			issues.push({
				severity: "error",
				message: `slide layout ${layoutName} is missing a slideMaster rel`,
				partName: layoutName
			});
			continue;
		}
		const masterName = targetPartName(layoutName, masterRel);
		if (pkg.getPart(masterName) === null) issues.push({
			severity: "error",
			message: `slide layout ${layoutName} references missing master ${masterName}`,
			partName: layoutName
		});
		for (const rel of slideRels.items) {
			if (rel.targetMode === "External") continue;
			if (rel.type !== REL_TYPES.image && rel.type !== REL_TYPES.media && rel.type !== REL_TYPES.video && rel.type !== REL_TYPES.audio && rel.type !== REL_TYPES.chart && rel.type !== REL_TYPES.notesSlide && rel.type !== REL_TYPES.comments && rel.type !== REL_TYPES.oleObject && rel.type !== REL_TYPES.package) continue;
			const targetName = targetPartName(slideName, rel);
			if (pkg.getPart(targetName) === null) issues.push({
				severity: "error",
				message: `slide ${slideName} has dangling ${rel.type.split("/").pop()} rel → ${targetName}`,
				partName: slideName
			});
		}
	}
	for (const slideName of slidePartNames) {
		const slidePart = pkg.getPart(slideName);
		if (!slidePart) continue;
		let slideRoot;
		try {
			slideRoot = parseXml(decode(slidePart.data)).root;
		} catch {
			continue;
		}
		const cSld = firstChildElement(slideRoot, qname("p", "cSld", NS.pml));
		if (!cSld) continue;
		const spTree = firstChildElement(cSld, qname("p", "spTree", NS.pml));
		if (!spTree) continue;
		const seenShapeIds = /* @__PURE__ */ new Map();
		const walk = (host) => {
			for (const child of host.children) {
				if (child.kind !== "element") continue;
				if (child.name.namespaceURI === NS.pml && child.name.localName === "grpSp") {
					walk(child);
					continue;
				}
				const nvHost = firstChildElement(child, qname("p", "nvSpPr", NS.pml)) ?? firstChildElement(child, qname("p", "nvPicPr", NS.pml)) ?? firstChildElement(child, qname("p", "nvCxnSpPr", NS.pml)) ?? firstChildElement(child, qname("p", "nvGrpSpPr", NS.pml)) ?? firstChildElement(child, qname("p", "nvGraphicFramePr", NS.pml));
				if (!nvHost) continue;
				const cNvPr = firstChildElement(nvHost, qname("p", "cNvPr", NS.pml));
				if (!cNvPr) continue;
				const id = getAttrValue(cNvPr, ATTR_ID$1);
				if (id === null) continue;
				seenShapeIds.set(id, (seenShapeIds.get(id) ?? 0) + 1);
			}
		};
		walk(spTree);
		for (const [id, count] of seenShapeIds) if (count > 1) issues.push({
			severity: "error",
			message: `duplicate shape id="${id}" appears ${count}× in slide ${slideName}`,
			partName: slideName
		});
		const timing = firstChildElement(slideRoot, qname("p", "timing", NS.pml));
		const checkMediaNodes = (host) => {
			for (const child of host.children) {
				if (child.kind !== "element") continue;
				if (!isMediaTimingNode(child)) {
					checkMediaNodes(child);
					continue;
				}
				const target = mediaTimingNodeTarget(child);
				if (target !== null && !seenShapeIds.has(String(target))) issues.push({
					severity: "error",
					message: `media time node in slide ${slideName} targets missing shape id="${target}"`,
					partName: slideName
				});
			}
		};
		if (timing) checkMediaNodes(timing);
	}
	for (const part of pkg.parts) {
		if (part.contentType !== "application/vnd.openxmlformats-officedocument.drawingml.chart+xml") continue;
		const chartRels = pkg.getRels(part.name);
		if (!chartRels) {
			issues.push({
				severity: "warning",
				message: `chart part ${part.name} has no .rels`,
				partName: part.name
			});
			continue;
		}
		const xlsxRel = chartRels.items.find((r) => r.type === REL_TYPES.package);
		if (xlsxRel) {
			const xlsxName = targetPartName(part.name, xlsxRel);
			if (pkg.getPart(xlsxName) === null) issues.push({
				severity: "error",
				message: `chart ${part.name} references missing embedded workbook ${xlsxName}`,
				partName: part.name
			});
		}
	}
	return issues;
};
//#endregion
//#region src/api/fn/validation.ts
/**
* Runs a set of lightweight invariant checks on the package and
* returns the list of issues found. An empty array means the deck
* passes every check.
*
* Catches the common authoring mistakes — missing presentation.xml,
* dangling slide rels, slides without a layout, etc. — without
* depending on a heavyweight XSD engine, so it runs identically in
* Node and the browser.
*
* Use it as a pre-save sanity check, especially after orchestrating
* lots of mutations against the same package. Higher-fidelity XSD
* validation lives in the test harness (Layer 1) and stays Node-only.
*/
const validatePresentation = (pres) => validatePresentationPackage(pres[INTERNAL_PACKAGE]);
//#endregion
//#region src/api/fn/package-introspection.ts
/**
* Power-user escape hatch. Returns the underlying `OpcPackage`
* backing `pres`. Use this when you need to manipulate parts /
* rels directly. Most callers should use the typed helpers above
* (`listPackageParts`, `readPackagePart`, `getMediaParts`, etc.).
*
* @internal — used by `@office-kit/pptx/node` to mount fs-backed helpers.
*/
const _internalPackageOf = (pres) => pres[INTERNAL_PACKAGE];
/**
* Enumerates every OPC part in the package. Useful for advanced
* inspection (e.g. "what parts does this template carry?") without
* dropping to `_internalPackageOf`.
*/
const listPackageParts = (pres) => pres[INTERNAL_PACKAGE].parts.map((p) => ({
	name: p.name,
	contentType: p.contentType,
	byteLength: p.data.byteLength
}));
/**
* Reads a single OPC part's bytes by part name (e.g.
* `'/ppt/slides/slide1.xml'`). Returns `null` when no such part
* exists. The returned `Uint8Array` is a live view into the
* package — DO NOT mutate it. Use this for read-only inspection
* (e.g. parsing custom extension parts).
*/
const readPackagePart = (pres, name) => {
	const target = name.toLowerCase();
	return pres[INTERNAL_PACKAGE].parts.find((p) => p.name.toLowerCase() === target)?.data ?? null;
};
/**
* Returns the total size of the package's parts in bytes
* (uncompressed). Useful for storage estimation, quota checks,
* and "how big is this deck before save?" diagnostics. The
* actual `savePresentation` output is typically smaller after
* DEFLATE; this is an upper bound.
*/
const getPackageSize = (pres) => {
	let total = 0;
	for (const part of pres[INTERNAL_PACKAGE].parts) total += part.data.byteLength;
	return total;
};
/**
* Returns every `/ppt/media/...` part in the package. Useful for
* audit / export workflows — e.g. "extract every embedded image."
*/
const getMediaParts = (pres) => {
	const out = [];
	for (const p of pres[INTERNAL_PACKAGE].parts) if (p.name.startsWith("/ppt/media/")) out.push({
		name: p.name,
		contentType: p.contentType,
		data: p.data
	});
	return out;
};
/**
* Returns every media part NOT referenced by any rels in the
* package — the set `compactPackage` would remove. Non-destructive;
* the caller decides whether to delete.
*
* Useful for audit UIs that want to surface bloat before cleaning,
* and for "is this asset still used?" checks.
*/
const getOrphanMediaPartNames = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const referenced = /* @__PURE__ */ new Set();
	const resolve = (sourcePart, target) => {
		if (target.startsWith("/")) return target;
		const dir = sourcePart.split("/").slice(0, -1);
		const segments = [];
		for (const seg of [...dir, ...target.split("/")]) if (seg === "..") segments.pop();
		else if (seg !== "." && seg.length > 0) segments.push(seg);
		return `/${segments.join("/")}`;
	};
	for (const part of pkg.parts) {
		if (!part.name.endsWith(".rels")) continue;
		const m = part.name.match(/^(.*)\/_rels\/(.+)\.rels$/);
		let sourceName;
		if (part.name === "/_rels/.rels") sourceName = "/";
		else if (m) sourceName = `${m[1]}/${m[2]}`;
		else continue;
		const sourceRels = sourceName === "/" ? pkg.rootRels() : pkg.getRels(sourceName);
		if (!sourceRels) continue;
		for (const rel of sourceRels.items) {
			if (rel.targetMode === "External") continue;
			referenced.add(resolve(sourceName, rel.target).toLowerCase());
		}
	}
	const out = [];
	for (const part of pkg.parts) {
		if (!part.name.startsWith("/ppt/media/")) continue;
		if (!referenced.has(part.name.toLowerCase())) out.push(part.name);
	}
	return out;
};
/**
* Returns every media part name the slide's rels reference
* (typically `/ppt/media/imageN.ext`). Walks the slide's rels
* graph and resolves each internal target. Useful for "which
* media files does this slide depend on?" audits.
*/
const getSlideMediaPartNames = (slide) => {
	const rels = slide[INTERNAL_PACKAGE].getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return [];
	const resolve = (sourcePart, target) => {
		if (target.startsWith("/")) return target;
		const dir = sourcePart.split("/").slice(0, -1);
		const segments = [];
		for (const seg of [...dir, ...target.split("/")]) if (seg === "..") segments.pop();
		else if (seg !== "." && seg.length > 0) segments.push(seg);
		return `/${segments.join("/")}`;
	};
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const rel of rels.items) {
		if (rel.targetMode === "External") continue;
		const resolved = resolve(slide[SLIDE_PART_NAME], rel.target);
		if (!resolved.startsWith("/ppt/media/")) continue;
		if (seen.has(resolved)) continue;
		seen.add(resolved);
		out.push(resolved);
	}
	return out;
};
/**
* Returns every slide that references the given media part name
* (typically `/ppt/media/imageN.ext`). Walks each slide's rels and
* checks whether any internal rel resolves to `mediaPartName`.
*
* Useful for image-audit workflows: "before I replace this image,
* which slides will the change affect?"
*/
const slidesUsingMediaPart = (pres, mediaPartName) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const resolve = (sourcePart, target) => {
		if (target.startsWith("/")) return target;
		const dir = sourcePart.split("/").slice(0, -1);
		const segments = [];
		for (const seg of [...dir, ...target.split("/")]) if (seg === "..") segments.pop();
		else if (seg !== "." && seg.length > 0) segments.push(seg);
		return `/${segments.join("/")}`;
	};
	const out = [];
	for (const slide of getSlides(pres)) {
		const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
		if (!rels) continue;
		if (rels.items.some((r) => r.targetMode !== "External" && resolve(slide[SLIDE_PART_NAME], r.target) === mediaPartName)) out.push(slide);
	}
	return out;
};
/**
* Removes media parts that no rels graph references. Returns the
* list of removed part names. Useful after a sequence of slide
* removals leaves orphan images behind.
*
* Only `/ppt/media/...` parts are considered. The check walks every
* `.rels` part in the package and resolves each internal rel target
* against its source part name to build the live media set.
*/
const compactPackage = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const referenced = /* @__PURE__ */ new Set();
	const resolve = (sourcePart, target) => {
		if (target.startsWith("/")) return target;
		const dir = sourcePart.split("/").slice(0, -1);
		const segments = [];
		for (const seg of [...dir, ...target.split("/")]) if (seg === "..") segments.pop();
		else if (seg !== "." && seg.length > 0) segments.push(seg);
		return `/${segments.join("/")}`;
	};
	for (const part of pkg.parts) {
		if (!part.name.endsWith(".rels")) continue;
		let sourceName = part.name.replace("/_rels/", "/").replace(/\.rels$/, "");
		if (sourceName === "/" || sourceName === "") sourceName = "/";
		const rels = sourceName === "/" ? null : pkg.getRels(partName(sourceName));
		if (!rels) continue;
		for (const rel of rels.items) {
			if (rel.targetMode === "External") continue;
			referenced.add(resolve(sourceName, rel.target).toLowerCase());
		}
	}
	const removed = [];
	const orphans = [];
	for (const part of pkg.parts) {
		if (!part.name.startsWith("/ppt/media/")) continue;
		if (!referenced.has(part.name.toLowerCase())) orphans.push(part.name);
	}
	for (const name of orphans) {
		pkg.removePart(partName(name));
		removed.push(name);
	}
	return { removed };
};
/**
* Replaces the bytes of a media part in place. Returns `true` if the
* part was found and updated, `false` otherwise. The content type is
* preserved.
*
* Useful for the "swap every instance of this logo" workflow — pick
* the right `partName` via `getMediaParts` and call this once. Every
* `<a:blip r:embed="…"/>` reference is unaffected because the rels
* already point at this part name.
*/
const setMediaPartBytes = (pres, partName, bytes) => {
	const target = partName.toLowerCase();
	const part = pres[INTERNAL_PACKAGE].parts.find((p) => p.name.toLowerCase() === target);
	if (!part) return false;
	part.data = bytes;
	return true;
};
const CHART_CONTENT_TYPE_FN = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const COMMENTS_CONTENT_TYPE_FN = "application/vnd.openxmlformats-officedocument.presentationml.comments+xml";
const getPresentationSummary = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const slides = getSlides(pres);
	let hiddenSlideCount = 0;
	let totalShapes = 0;
	const shapesByKind = {
		shape: 0,
		picture: 0,
		group: 0,
		graphicFrame: 0,
		connector: 0
	};
	let hasAnimations = false;
	for (const slide of slides) {
		if (isSlideHidden(slide)) hiddenSlideCount++;
		for (const s of slide[SLIDE_SHAPES]) {
			totalShapes++;
			shapesByKind[s[SHAPE_SNAPSHOT].kind]++;
		}
		if (!hasAnimations && slide[SLIDE_DOCUMENT].root.children.some((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "timing")) hasAnimations = true;
	}
	const hasCharts = pkg.parts.some((p) => p.contentType === CHART_CONTENT_TYPE_FN);
	const hasComments = pkg.parts.some((p) => p.contentType === COMMENTS_CONTENT_TYPE_FN);
	const theme = getPresentationTheme(pres);
	return {
		slideCount: slides.length,
		hiddenSlideCount,
		totalShapes,
		shapesByKind,
		layoutCount: getSlideLayouts(pres).length,
		sectionCount: getSlideSections(pres).length,
		partCount: pkg.parts.length,
		hasCharts,
		hasComments,
		hasAnimations,
		themeName: theme?.name ?? null
	};
};
//#endregion
//#region src/api/fn/slide-transition.ts
const removeTransition = (slide) => {
	slide[SLIDE_DOCUMENT].root.children = slide[SLIDE_DOCUMENT].root.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "transition"));
};
const insertAfterClrMapOvr = (slide, t) => {
	const children = slide[SLIDE_DOCUMENT].root.children;
	let insertAt = children.length;
	for (let i = 0; i < children.length; i++) {
		const c = children[i];
		if (c?.kind !== "element" || c.name.namespaceURI !== NS.pml) continue;
		if (c.name.localName === "clrMapOvr") insertAt = i + 1;
		else if (c.name.localName === "cSld" && insertAt === children.length) insertAt = i + 1;
	}
	children.splice(insertAt, 0, t);
};
/**
* Reads back the slide's current transition (or `null` if no
* `<p:transition>` is present). The returned shape mirrors what
* `setSlideTransition` accepts.
*/
const getSlideTransition = (slide) => {
	const transition = slide[SLIDE_DOCUMENT].root.children.find((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "transition");
	if (!transition) return null;
	const speed = getAttrValue(transition, qname("", "spd", ""));
	const advClick = getAttrValue(transition, qname("", "advClick", ""));
	const advTm = getAttrValue(transition, qname("", "advTm", ""));
	let effect = null;
	let direction = null;
	let orientation = null;
	let thruBlack;
	for (const child of transition.children) {
		if (child.kind !== "element" || child.name.namespaceURI !== NS.pml) continue;
		effect = child.name.localName;
		direction = getAttrValue(child, qname("", "dir", ""));
		const o = getAttrValue(child, qname("", "orient", ""));
		if (o === "horz" || o === "vert") orientation = o;
		const tb = getAttrValue(child, qname("", "thruBlk", ""));
		if (tb !== null) thruBlack = tb === "1";
		break;
	}
	if (effect === null) return null;
	return {
		effect,
		...speed !== null ? { speed } : {},
		...direction !== null ? { direction } : {},
		...orientation !== null ? { orientation } : {},
		...thruBlack !== void 0 ? { thruBlack } : {},
		...advClick !== null ? { advanceOnClick: advClick !== "0" } : {},
		...advTm !== null ? { advanceAfterMs: Number.parseInt(advTm, 10) } : {}
	};
};
/** Sets the slide's transition effect. */
const setSlideTransition = (slide, options) => {
	const transition = buildTransition(options);
	removeTransition(slide);
	insertAfterClrMapOvr(slide, transition);
	commitSlideData(slide);
	refreshSlideData(slide);
};
/** Removes any existing transition on the slide. */
const clearSlideTransition = (slide) => {
	removeTransition(slide);
	commitSlideData(slide);
	refreshSlideData(slide);
};
//#endregion
//#region src/api/fn/slide-notes.ts
const findNotesPartName = (slide) => {
	const rels = slide[INTERNAL_PACKAGE].getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	const notesRel = rels.items.find((r) => r.type === REL_TYPES.notesSlide);
	if (!notesRel) return null;
	return notesRel.target.startsWith("/") ? partName(notesRel.target) : resolveTarget(slide[SLIDE_PART_NAME], notesRel.target);
};
/**
* Returns the slide's speaker notes (`null` if none). Pulls plain text
* from the `body` placeholder; multi-line notes use `\n`.
*/
const getSlideNotes = (slide) => {
	const notesPartName = findNotesPartName(slide);
	if (notesPartName === null) return null;
	const part = slide[INTERNAL_PACKAGE].getPart(notesPartName);
	if (part === null) return null;
	const root = parseXml(decode$1(part.data)).root;
	const cSld = firstChildElement(root, NAME_CSLD);
	if (!cSld) return null;
	const spTree = firstChildElement(cSld, NAME_SP_TREE);
	if (!spTree) return null;
	for (const child of spTree.children) {
		if (child.kind !== "element" || child.name.namespaceURI !== NS.pml) continue;
		if (child.name.localName !== "sp") continue;
		const nvSpPr = firstChildElement(child, qname("p", "nvSpPr", NS.pml));
		if (!nvSpPr) continue;
		const nvPr = firstChildElement(nvSpPr, qname("p", "nvPr", NS.pml));
		if (!nvPr) continue;
		if (!firstChildElement(nvPr, qname("p", "ph", NS.pml))) continue;
		const txBody = firstChildElement(child, qname("p", "txBody", NS.pml));
		if (!txBody) continue;
		const lines = [];
		for (const p of txBody.children) {
			if (p.kind !== "element" || p.name.namespaceURI !== NS.dml || p.name.localName !== "p") continue;
			let line = "";
			for (const r of p.children) {
				if (r.kind !== "element" || r.name.namespaceURI !== NS.dml || r.name.localName !== "r") continue;
				for (const tElement of r.children) if (tElement.kind === "element" && tElement.name.namespaceURI === NS.dml && tElement.name.localName === "t") {
					for (const tc of tElement.children) if (tc.kind === "text") line += tc.data;
				}
			}
			lines.push(line);
		}
		return lines.join("\n");
	}
	return null;
};
/**
* Sets the slide's speaker notes. Creates the `notesSlide` part and
* wires up the rels (slide ↔ notesSlide ↔ notesMaster) on first call;
* subsequent calls just replace the body placeholder text.
*/
/**
* Returns every slide whose `<p:sldId show="0">` flag is set —
* complement of `getVisibleSlides`. Useful for audit UIs and
* batch-unhide operations.
*/
const getHiddenSlides = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (isSlideHidden(slide)) out.push(slide);
	return out;
};
/**
* Returns every slide in document order whose `<p:sldId show="0">`
* flag is *not* set. Convenience over `getSlides(pres).filter(s =>
* !isSlideHidden(s))` — useful when an export pipeline needs to
* skip hidden slides without touching the `show` attribute itself.
*/
const getVisibleSlides = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (!isSlideHidden(slide)) out.push(slide);
	return out;
};
/**
* Returns every slide carrying at least one chart graphic frame.
* Built on `isChartShape`.
*/
const getSlidesWithCharts = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (slide[SLIDE_SHAPES].some((s) => isChartShape(s))) out.push(slide);
	return out;
};
/**
* Filters `getSlidesWithCharts` to slides carrying at least one chart
* of the given `kind` (`'bar'`, `'column'`, `'line'`, `'pie'`,
* `'doughnut'`, `'area'`). Reads each chart's spec via `getSlideCharts`
* so the predicate respects what the renderers actually see.
*/
const findSlidesWithChartKind = (pres, kind) => {
	const out = [];
	for (const slide of getSlides(pres)) for (const c of getSlideCharts(slide)) if (c.spec?.kind === kind) {
		out.push(slide);
		break;
	}
	return out;
};
/**
* Presentation-level version of `findChartsWithTrendlines`. Returns
* every slide carrying at least one chart with a trendline on any
* series. Useful for "audit every trendline in this deck" workflows
* before publishing.
*/
const findSlidesWithChartTrendlines = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) for (const c of getSlideCharts(slide)) {
		if (c.spec === null) continue;
		if (c.spec.series.some((s) => s.trendline !== void 0)) {
			out.push(slide);
			break;
		}
	}
	return out;
};
/**
* Returns every slide where at least two shapes have overlapping
* bounding boxes. Built on `findOverlappingShapePairs`. Useful for
* deck-wide layout audits — surfacing slides that may have stacked
* or accidentally-colliding content for human review.
*/
const getSlidesWithOverlap = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (findOverlappingShapePairs(slide).length > 0) out.push(slide);
	return out;
};
/**
* Returns every slide carrying at least one table graphic frame.
* Built on `isTableShape`.
*/
const getSlidesWithTables = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (slide[SLIDE_SHAPES].some((s) => isTableShape(s))) out.push(slide);
	return out;
};
/**
* Returns every slide carrying at least one image-bearing shape
* (a `<p:pic>` picture or a regular shape with `<a:blipFill>`).
* Built on `hasShapeImage`.
*/
const getSlidesWithImages = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (slide[SLIDE_SHAPES].some((s) => hasShapeImage(s))) out.push(slide);
	return out;
};
/**
* Returns every slide that has at least one comment attached.
* Convenience over `getSlides(pres).filter(s =>
* getSlideComments(s).length > 0)`.
*/
const getSlidesWithComments = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (getSlideComments(slide).length > 0) out.push(slide);
	return out;
};
/**
* Returns every image-bearing shape across the deck (pictures and
* shapes with `<a:blipFill>`), paired with its 0-based slide
* index. Built on `hasShapeImage`.
*/
const getAllImages = (pres) => {
	const out = [];
	const slides = getSlides(pres);
	for (let i = 0; i < slides.length; i++) for (const shape of slides[i][SLIDE_SHAPES]) if (hasShapeImage(shape)) out.push({
		slideIndex: i,
		shape
	});
	return out;
};
/**
* Returns every table across every slide in the deck, paired with
* the 0-based index of its slide. Built on `isTableShape`.
*/
const getAllTables = (pres) => {
	const out = [];
	const slides = getSlides(pres);
	for (let i = 0; i < slides.length; i++) for (const shape of slides[i][SLIDE_SHAPES]) if (isTableShape(shape)) out.push({
		slideIndex: i,
		table: shape
	});
	return out;
};
/**
* Returns every chart across every slide in the deck, paired with
* the 0-based index of its slide. Useful for chart-inventory UIs
* and bulk chart-update pipelines.
*/
const getAllCharts = (pres) => {
	const out = [];
	const slides = getSlides(pres);
	for (let i = 0; i < slides.length; i++) for (const c of getSlideCharts(slides[i])) out.push({
		slideIndex: i,
		chart: c
	});
	return out;
};
/**
* Returns every external hyperlink in the deck — one entry per
* shape whose text body carries an `<a:hlinkClick>`. Useful for
* "link audit" passes before publishing, and for building a
* deck-wide table of contents of outbound URLs.
*/
const getAllHyperlinks = (pres) => {
	const out = [];
	const slides = getSlides(pres);
	for (let i = 0; i < slides.length; i++) for (const shape of slides[i][SLIDE_SHAPES]) {
		const url = getShapeHyperlink(shape);
		if (url !== null) out.push({
			slideIndex: i,
			shape,
			url
		});
	}
	return out;
};
/**
* Dense per-slide hyperlink count array. Counts shapes whose
* `getShapeHyperlink` is non-null, mirroring `getAllHyperlinks` but
* cheaper when the caller only wants per-slide counts. Rounds out the
* deck-density family alongside the chart / table / image / shape /
* text / comment counters.
*/
const getPresentationHyperlinkCountsBySlide = (pres) => getSlides(pres).map((s) => s[SLIDE_SHAPES].filter((sh) => getShapeHyperlink(sh) !== null).length);
/**
* Returns every distinct external URL referenced by any shape in
* the deck, in first-seen order. Sibling of `getAllHyperlinks`
* (which keeps duplicates and slide indices). Useful for "are
* these URLs all live?" audits where checking each URL once is
* enough.
*/
const getDistinctHyperlinkUrls = (pres) => {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const slide of getSlides(pres)) for (const shape of slide[SLIDE_SHAPES]) {
		const url = getShapeHyperlink(shape);
		if (url !== null && !seen.has(url)) {
			seen.add(url);
			out.push(url);
		}
	}
	return out;
};
/**
* Returns every slide carrying at least one shape with an external
* hyperlink. Built on `findHyperlinkedShapes`. Useful for navigation
* UIs that want to surface only the slides containing outbound URLs.
*/
const getSlidesWithHyperlinks = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (slide[SLIDE_SHAPES].some((s) => getShapeHyperlink(s) !== null)) out.push(slide);
	return out;
};
/**
* Returns every slide containing at least one shape whose external
* hyperlink matches `needle` (substring or `RegExp`). Sibling of
* `findSlidesByText` for outbound-URL audits — e.g. "every slide
* that links to old.docs.example.com".
*/
const findSlidesByHyperlink = (pres, needle) => {
	const out = [];
	for (const slide of getSlides(pres)) for (const shape of slide[SLIDE_SHAPES]) {
		const url = getShapeHyperlink(shape);
		if (url === null) continue;
		if (typeof needle === "string" ? url.includes(needle) : needle.test(url)) {
			out.push(slide);
			break;
		}
	}
	return out;
};
/**
* Bulk URL migration. Re-points every shape across the deck whose
* first hyperlink exactly equals `from` to instead point at `to`.
* Returns the number of shapes updated. Built on
* `setShapeHyperlink`, so each update goes through the standard
* rels-allocation path and stays schema-valid.
*
* Matching is exact (case-sensitive). To migrate by pattern, use
* `findSlidesByHyperlink` to locate slides and rewrite each shape
* yourself.
*/
const replaceHyperlink = (pres, from, to) => {
	let n = 0;
	for (const slide of getSlides(pres)) for (const shape of slide[SLIDE_SHAPES]) if (getShapeHyperlink(shape) === from) {
		setShapeHyperlink(shape, to);
		n++;
	}
	return n;
};
/**
* Removes every external hyperlink across the deck — useful for
* sanitizing a template before sharing, or for stripping outbound
* URLs from an exported preview. Returns the number of shapes
* cleared. Each call goes through `setShapeHyperlink(_, null)`.
*/
const clearAllHyperlinks = (pres) => {
	let n = 0;
	for (const slide of getSlides(pres)) for (const shape of slide[SLIDE_SHAPES]) if (getShapeHyperlink(shape) !== null) {
		setShapeHyperlink(shape, null);
		n++;
	}
	return n;
};
/**
* Slide-scoped sibling of `clearAllHyperlinks`. Removes every
* external hyperlink on this slide and returns the number of
* shapes cleared.
*/
const clearSlideHyperlinks = (slide) => {
	let n = 0;
	for (const shape of slide[SLIDE_SHAPES]) if (getShapeHyperlink(shape) !== null) {
		setShapeHyperlink(shape, null);
		n++;
	}
	return n;
};
/**
* Returns every comment across every slide in the deck, each paired
* with the 0-based index of its slide. Useful for review-summary
* UIs that show all annotations in one chronological list.
*/
const getAllComments = (pres) => {
	const out = [];
	const slides = getSlides(pres);
	for (let i = 0; i < slides.length; i++) for (const c of getSlideComments(slides[i])) out.push({
		slideIndex: i,
		comment: c
	});
	return out;
};
/**
* Returns every slide's speaker notes alongside its 0-based index.
* Skips slides whose notes are empty / unset.
*/
const getAllNotes = (pres) => {
	const out = [];
	const slides = getSlides(pres);
	for (let i = 0; i < slides.length; i++) {
		const notes = getSlideNotes(slides[i]);
		if (notes !== null && notes.length > 0) out.push({
			slideIndex: i,
			notes
		});
	}
	return out;
};
/**
* Returns every slide in the presentation that carries non-empty
* speaker notes. Convenience over `getSlides(pres).filter(s =>
* getSlideNotes(s) !== null && getSlideNotes(s) !== '')`.
*/
const getSlidesWithNotes = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) {
		const notes = getSlideNotes(slide);
		if (notes !== null && notes.length > 0) out.push(slide);
	}
	return out;
};
/**
* Predicate sibling of `getSlideNotes`. Returns `true` when the
* slide carries a non-empty `notesSlide` body — i.e. whatever
* `getSlideNotes(slide)` would surface is a non-empty string.
*
* Cheap to call in hot loops where the caller only needs to know
* "are there any notes here?" without materializing the text.
*/
const hasSlideNotes = (slide) => {
	const notes = getSlideNotes(slide);
	return notes !== null && notes.length > 0;
};
/**
* Code-point length of the slide's speaker notes, or `0` when the
* slide has no notes. Counts via `Array.from`, so surrogate-pair
* characters (emoji, supplementary CJK) count as 1 — matches
* `getSlideTextLength`.
*/
const getSlideNotesLength = (slide) => {
	const notes = getSlideNotes(slide);
	return notes === null ? 0 : Array.from(notes).length;
};
/**
* Concatenated speaker notes from every slide, joined with the
* given `separator` (defaults to a form-feed, `\f`). Slides with
* no notes contribute the empty string. Sibling of
* `getPresentationText` — useful for search-indexing notes
* across a whole deck.
*/
const getPresentationNotesText = (pres, separator = "\f") => {
	const parts = [];
	for (const slide of getSlides(pres)) parts.push(getSlideNotes(slide) ?? "");
	return parts.join(separator);
};
/**
* Total code-point length of speaker notes across every slide.
* Sibling of `getPresentationTextLength`; counts surrogate-pair
* characters as 1 each. Cheaper than `getPresentationNotesText`
* when the caller only needs the size.
*/
const getPresentationNotesLength = (pres) => {
	let n = 0;
	for (const slide of getSlides(pres)) n += getSlideNotesLength(slide);
	return n;
};
/**
* Dense per-slide notes-length array. Code-point length per
* `getSlideNotesLength` (`0` when the slide has no notes part). Pair
* with `getPresentationTextLengthsBySlide` for handout / talk-track
* audits — slides with no on-screen text but heavy speaker notes are
* often the slow part of a presentation.
*/
const getPresentationNotesLengthsBySlide = (pres) => getSlides(pres).map((s) => getSlideNotesLength(s));
/**
* Returns every slide whose `<p:spTree>` carries no shapes (per
* `getSlideShapes`). Useful as a "find the section dividers I forgot
* to fill in" pre-publish check.
*/
const getEmptySlides = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (slide[SLIDE_SHAPES].length === 0) out.push(slide);
	return out;
};
/**
* Appends `text` to the slide's existing notes on its own line.
* Equivalent to `setSlideNotes(slide, (getSlideNotes(slide) ?? '') + '\n' + text)`,
* minus the leading newline when there were no notes yet.
*/
const appendSlideNotes = (slide, text) => {
	const existing = getSlideNotes(slide);
	setSlideNotes(slide, existing === null || existing.length === 0 ? text : `${existing}\n${text}`);
};
const setSlideNotes = (slide, value) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const notesPartName = findNotesPartName(slide);
	if (notesPartName !== null) {
		const part = pkg.getPart(notesPartName);
		if (part === null) throw new Error(`notes rel points at missing part ${notesPartName}`);
		const doc = parseXml(decode$1(part.data));
		const cSld = firstChildElement(doc.root, NAME_CSLD);
		if (!cSld) throw new Error("notesSlide has no <p:cSld>");
		const spTree = firstChildElement(cSld, NAME_SP_TREE);
		if (!spTree) throw new Error("notesSlide has no <p:spTree>");
		for (const child of spTree.children) {
			if (child.kind !== "element" || child.name.namespaceURI !== NS.pml) continue;
			if (child.name.localName !== "sp") continue;
			const nvSpPr = firstChildElement(child, qname("p", "nvSpPr", NS.pml));
			if (!nvSpPr) continue;
			const nvPr = firstChildElement(nvSpPr, qname("p", "nvPr", NS.pml));
			if (!nvPr) continue;
			if (!firstChildElement(nvPr, qname("p", "ph", NS.pml))) continue;
			const txBody = firstChildElement(child, qname("p", "txBody", NS.pml));
			if (!txBody) continue;
			setTextBody(txBody, value);
			part.data = encode$1(serializeXml(doc));
			return;
		}
		throw new Error("notesSlide has no body placeholder to fill");
	}
	const notesMasterPart = pkg.parts.find((p) => p.contentType.endsWith("notesMaster+xml"));
	let nextN = 1;
	const pattern = /^\/ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
	for (const p of pkg.parts) {
		const m = p.name.match(pattern);
		if (m?.[1] !== void 0) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n) && n >= nextN) nextN = n + 1;
		}
	}
	const notesName = partName(`/ppt/notesSlides/notesSlide${nextN}.xml`);
	const doc = buildEmptyNotesSlide(value);
	pkg.addPart(notesName, "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml", encode$1(serializeXml(doc)));
	const notesRels = emptyRels();
	const slideBase = slide[SLIDE_PART_NAME].split("/").pop() ?? "slide.xml";
	notesRels.items.push({
		id: "rId1",
		type: REL_TYPES.slide,
		target: `../slides/${slideBase}`,
		targetMode: "Internal"
	});
	if (notesMasterPart) {
		const notesMasterBase = notesMasterPart.name.split("/").pop() ?? "notesMaster1.xml";
		notesRels.items.push({
			id: "rId2",
			type: REL_TYPES.notesMaster,
			target: `../notesMasters/${notesMasterBase}`,
			targetMode: "Internal"
		});
	}
	pkg.setRels(notesName, notesRels);
	const slideRels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
	const existingIds = slideRels.items.map((r) => r.id);
	let n = 1;
	while (existingIds.includes(`rId${n}`)) n++;
	slideRels.items.push({
		id: `rId${n}`,
		type: REL_TYPES.notesSlide,
		target: `../notesSlides/notesSlide${nextN}.xml`,
		targetMode: "Internal"
	});
	pkg.setRels(slide[SLIDE_PART_NAME], slideRels);
};
/**
* Removes the slide's speaker-notes part entirely. Drops the
* `notesSlide` part + its `.rels`, and unwires the slide → notesSlide
* relationship. No-op when the slide has no notes.
*
* The shared `notesMaster` part is left alone; other slides may still
* reference it.
*/
const removeSlideNotes = (slide) => {
	const notesPartName = findNotesPartName(slide);
	if (notesPartName === null) return;
	const pkg = slide[INTERNAL_PACKAGE];
	pkg.removePart(notesPartName);
	pkg.removePart(relsPartNameFor(notesPartName));
	const slideRels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (slideRels === null) return;
	slideRels.items = slideRels.items.filter((r) => r.type !== REL_TYPES.notesSlide);
	pkg.setRels(slide[SLIDE_PART_NAME], slideRels);
};
/**
* Removes the speaker-notes part from every slide that has one.
* Built on `removeSlideNotes`. Returns the number of slides
* stripped. Useful as a privacy/sharing helper before exporting a
* deck whose notes contain internal commentary.
*/
const clearAllSlideNotes = (pres) => {
	let n = 0;
	for (const slide of getSlides(pres)) {
		if (findNotesPartName(slide) === null) continue;
		removeSlideNotes(slide);
		n++;
	}
	return n;
};
//#endregion
//#region src/api/fn/slide-size.ts
/** Returns the slide canvas size, or `null` if `presentation.xml` omits it. */
const getSlideSize = (pres) => {
	const presPart = pres[INTERNAL_PACKAGE].getPart(PRES_PART_NAME);
	if (presPart === null) return null;
	const root = parseXml(decode$1(presPart.data)).root;
	const model = readPresentationPart(root);
	if (model.slideSize === null) return null;
	return {
		width: model.slideSize.cx,
		height: model.slideSize.cy,
		...model.slideSize.type !== void 0 ? { type: model.slideSize.type } : {}
	};
};
const NAME_SLD_SZ_FN = qname("p", "sldSz", NS.pml);
const ATTR_CX = qname("", "cx", "");
const ATTR_CY = qname("", "cy", "");
const ATTR_TYPE = qname("", "type", "");
const NAME_SLD_ID_LST_FN = qname("p", "sldIdLst", NS.pml);
/**
* Sets the slide canvas size. Creates `<p:sldSz>` when absent, replaces
* its attributes when present. The `type` hint is preserved as given.
*
* Schema ordering: `<p:sldSz>` follows `<p:sldIdLst>` per ECMA-376
* §19.2.1.26; we insert at the correct position when bootstrapping.
*/
const setSlideSize = (pres, opts) => {
	if (opts.type !== void 0) oneOf(opts.type, SLIDE_SIZE_TYPES, "setSlideSize: type");
	const presPart = pres[INTERNAL_PACKAGE].getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml is missing");
	const doc = parseXml(decode$1(presPart.data));
	let sldSz = firstChildElement(doc.root, NAME_SLD_SZ_FN);
	if (sldSz === null) {
		sldSz = elem(NAME_SLD_SZ_FN);
		const sldIdLst = firstChildElement(doc.root, NAME_SLD_ID_LST_FN);
		if (sldIdLst !== null) {
			const idx = doc.root.children.indexOf(sldIdLst);
			doc.root.children.splice(idx + 1, 0, sldSz);
		} else doc.root.children.push(sldSz);
	}
	sldSz.attrs = [attr(ATTR_CX, String(opts.width)), attr(ATTR_CY, String(opts.height))];
	if (opts.type !== void 0) sldSz.attrs.push(attr(ATTR_TYPE, opts.type));
	presPart.data = encode$1(serializeXml(doc));
};
/** 10in × 7.5in (`screen4x3`). */
const SLIDE_SIZE_4_3 = {
	width: emu(9144e3),
	height: emu(6858e3),
	type: "screen4x3"
};
/** 13.333in × 7.5in (`screen16x9`) — Office 2013+ default. */
const SLIDE_SIZE_16_9 = {
	width: emu(12192e3),
	height: emu(6858e3),
	type: "screen16x9"
};
/** 13.333in × 8.33in (`screen16x10`). */
const SLIDE_SIZE_16_10 = {
	width: emu(12192e3),
	height: emu(762e4),
	type: "screen16x10"
};
//#endregion
//#region src/api/fn/shape-image-effects.ts
const NAME_ALPHA_MOD_FIX_FN = qname("a", "alphaModFix", NS.dml);
const ATTR_AMT_FN = qname("", "amt", "");
/**
* Sets the picture's opacity (0–1 fraction; `1` is fully opaque, `0`
* fully transparent). Pass `null` to remove an existing opacity
* override and restore PowerPoint's default behavior.
*
* Throws for non-picture shapes and on opacities outside `[0, 1]`.
*/
/**
* Returns the embedded image bytes for a picture shape, or `null`
* when the shape isn't a picture or has no `r:embed` reference
* (external images aren't followed).
*
* The returned `Uint8Array` is a live view into the package media
* part — treat it as read-only; copy if you need an independent
* buffer.
*/
const getShapeImageBytes = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") return null;
	const rEmbed = getPictureEmbedRId(shape[SHAPE_ELEMENT]);
	if (rEmbed === null) return null;
	const slide = shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	const rel = rels.items.find((r) => r.id === rEmbed);
	if (!rel || rel.targetMode === "External") return null;
	const mediaName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
	return pkg.getPart(mediaName)?.data ?? null;
};
/**
* `true` when the shape's text body carries any visible characters.
* Tighter than checking `getShapeText(shape) !== ''` because it
* doesn't allocate the concatenated string.
*/
const hasShapeText = (shape) => {
	const text = shape[SHAPE_SNAPSHOT].text;
	return typeof text === "string" && text.length > 0;
};
/**
* `true` when the shape carries an embedded image — either a
* `<p:pic>` picture or a `<p:spPr>/<a:blipFill>` image fill on a
* regular shape. External `r:link` references count too.
*/
const hasShapeImage = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind === "picture") return getPictureEmbedRId(shape[SHAPE_ELEMENT]) !== null;
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return false;
	return firstChildElement(spPr, qname("a", "blipFill", NS.dml)) !== null;
};
/**
* Dense per-slide image count array. Counts every shape that
* `hasShapeImage` matches on each slide. Rounds out the density-array
* family alongside the chart, table, shape, text, and comment
* counters.
*/
const getPresentationImageCountsBySlide = (pres) => getSlides(pres).map((s) => s[SLIDE_SHAPES].filter((sh) => hasShapeImage(sh)).length);
/**
* Returns every shape on the slide that is mirrored — horizontally
* (`flipH`), vertically (`flipV`), or both.
*/
const findFlippedShapes = (slide) => slide[SLIDE_SHAPES].filter((s) => {
	const flip = getShapeFlip(s);
	return flip !== null && (flip.horizontal || flip.vertical);
});
/**
* Returns every unordered pair of shapes on the slide whose
* bounding boxes overlap. Built on `shapesOverlap`. Pairs are
* returned with `a` strictly preceding `b` in document order, and
* each pair appears at most once.
*
* Useful for layout audits — "do any boxes collide on this slide?"
* Shapes without `<a:xfrm>` bounds never overlap anything.
*/
const findOverlappingShapePairs = (slide) => {
	const shapes = slide[SLIDE_SHAPES];
	const out = [];
	for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) if (shapesOverlap(shapes[i], shapes[j])) out.push([shapes[i], shapes[j]]);
	return out;
};
/**
* Returns every shape on the slide whose bounding box extends past
* the slide canvas (`getSlideSize(pres)`). Useful audit helper for
* catching shapes that PowerPoint will silently render off-screen
* or clip on export. Shapes without `<a:xfrm>` bounds are skipped.
*
* If the presentation has no slide-size declared, every positioned
* shape is returned (caller can't audit against an absent canvas).
*/
const findShapesOutsideCanvas = (slide, pres) => {
	const size = getSlideSize(pres);
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) {
		const b = getShapeBounds(shape);
		if (b === null) continue;
		if (size === null) {
			out.push(shape);
			continue;
		}
		if (b.x < 0 || b.y < 0 || b.x + b.w > size.width || b.y + b.h > size.height) out.push(shape);
	}
	return out;
};
/**
* Every slide whose layout's `cSld@name` matches the given string.
* Useful for batch operations on slides sharing a layout — for
* example, restyling every "Title and Content" slide in a deck.
*
* Matching is exact (case-sensitive). Slides without a resolved
* layout are skipped.
*/
const findSlidesByLayoutName = (pres, layoutName) => {
	const matches = typeof layoutName === "string" ? (n) => n === layoutName : (n) => layoutName.test(n);
	const out = [];
	for (const slide of getSlides(pres)) {
		const layout = getSlideLayout(slide);
		if (layout !== null && matches(getSlideLayoutName(layout))) out.push(slide);
	}
	return out;
};
/**
* Every slide whose resolved layout part name equals `layoutPartName`
* (e.g. `'/ppt/slideLayouts/slideLayout3.xml'`). Stable across
* template-name collisions and locale renames — keyed on the actual
* package path. Pair to `findSlidesByLayoutName` /
* `findSlidesByLayoutType` for cases where the caller already has a
* layout part name in hand (typical when iterating over a layouts
* collection programmatically).
*/
const findSlidesByLayoutPartName = (pres, layoutPartName) => {
	const out = [];
	for (const slide of getSlides(pres)) {
		const layout = getSlideLayout(slide);
		if (layout !== null && getSlideLayoutPartName(layout) === layoutPartName) out.push(slide);
	}
	return out;
};
/**
* Every slide whose layout `@type` (e.g. `'title'`, `'blank'`,
* `'obj'`) matches. Sibling of `findSlidesByLayoutName`, but keyed
* on the OOXML layout-type enum rather than the human-facing name —
* stable across locales and template providers.
*/
const findSlidesByLayoutType = (pres, layoutType) => {
	const out = [];
	for (const slide of getSlides(pres)) {
		const layout = getSlideLayout(slide);
		if (layout !== null && getSlideLayoutType(layout) === layoutType) out.push(slide);
	}
	return out;
};
/**
* Returns the package part name (`/ppt/media/imageN.ext`) of
* whichever image the shape carries — picture (`<p:pic>`) or
* image-fill (`<a:blipFill>` nested under `<p:spPr>`). Returns
* `null` when the shape has no embedded image, or the rel points
* at an external `r:link` rather than an internal target.
*
* Useful for addressing the media part directly with
* `setMediaPartBytes` or `readPackagePart`.
*/
/**
* Returns the external URL of the picture when its `<a:blip>` carries an
* `r:link` (external) relationship rather than an `r:embed`. Returns
* `null` for embedded pictures, non-picture shapes, or when the
* relationship doesn't resolve.
*
* PowerPoint emits `r:link` when the user inserts via "Link to file"
* instead of "Insert Picture". The bytes live outside the package, so
* `getShapeImageBytes` can't render them — readers / preview tools
* should fall back to this URL or a placeholder.
*/
/**
* Returns `true` when the picture's `<a:blip>` carries `<a:grayscl/>`
* — PowerPoint's "Color > Grayscale" recolor preset. Renderers can
* project this onto a CSS `filter: grayscale(100%)` or an SVG
* `<feColorMatrix>` desaturation.
*/
const isShapeImageGrayscale = (shape) => {
	let blip = null;
	if (shape[SHAPE_SNAPSHOT].kind === "picture") {
		const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
		if (blipFill) blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	} else {
		const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
		if (spPr) {
			const bf = firstChildElement(spPr, qname("a", "blipFill", NS.dml));
			if (bf) blip = firstChildElement(bf, qname("a", "blip", NS.dml));
		}
	}
	return blip !== null && firstChildElement(blip, qname("a", "grayscl", NS.dml)) !== null;
};
/**
* Returns the threshold of the picture's `<a:blip><a:biLevel thresh="…"/>`
* effect — PowerPoint's "Color > Black and White" preset. Threshold is
* a percent (0..100); pixels brighter become white, darker become black.
* Returns `null` when no biLevel transform is set.
*/
const getShapeImageBiLevelThreshold = (shape) => {
	let blip = null;
	if (shape[SHAPE_SNAPSHOT].kind === "picture") {
		const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
		if (blipFill) blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	} else {
		const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
		if (spPr) {
			const bf = firstChildElement(spPr, qname("a", "blipFill", NS.dml));
			if (bf) blip = firstChildElement(bf, qname("a", "blip", NS.dml));
		}
	}
	if (!blip) return null;
	const biLevel = firstChildElement(blip, qname("a", "biLevel", NS.dml));
	if (!biLevel) return null;
	const t = getAttrValue(biLevel, qname("", "thresh", ""));
	if (t === null) return null;
	let n = Number.parseFloat(t);
	if (!Number.isFinite(n)) return null;
	if (Math.abs(n) > 1) n = n / 1e5;
	return n * 100;
};
/**
* Reads the picture's duotone color transform from `<a:blip><a:duotone>`.
* PowerPoint emits two `<a:srgbClr>` (or scheme color) children for a
* two-color duotone effect — typical "Picture Tools › Recolor".
* Returns `null` when no duotone is set.
*/
const getShapeImageDuotone = (pres, shape) => {
	let blip = null;
	if (shape[SHAPE_SNAPSHOT].kind === "picture") {
		const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
		if (blipFill) blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	} else {
		const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
		if (spPr) {
			const bf = firstChildElement(spPr, qname("a", "blipFill", NS.dml));
			if (bf) blip = firstChildElement(bf, qname("a", "blip", NS.dml));
		}
	}
	if (!blip) return null;
	const duotone = firstChildElement(blip, qname("a", "duotone", NS.dml));
	if (!duotone) return null;
	const theme = getPresentationTheme(pres);
	const colors = [];
	for (const c of duotone.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "srgbClr" || c.name.localName === "schemeClr" || c.name.localName === "sysClr" || c.name.localName === "prstClr") {
			colors.push(resolveDrawingColor(c, theme));
			if (colors.length === 2) break;
		}
	}
	return {
		firstColor: colors[0] ?? null,
		secondColor: colors[1] ?? null
	};
};
const getShapeImageLinkUrl = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const rels = slide[INTERNAL_PACKAGE].getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	let blip = null;
	if (shape[SHAPE_SNAPSHOT].kind === "picture") {
		const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
		if (blipFill) blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	} else {
		const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
		if (spPr) {
			const bf = firstChildElement(spPr, qname("a", "blipFill", NS.dml));
			if (bf) blip = firstChildElement(bf, qname("a", "blip", NS.dml));
		}
	}
	if (!blip) return null;
	const rLink = getAttrValue(blip, qname("r", "link", NS.officeDocRels));
	if (!rLink) return null;
	const rel = rels.items.find((r) => r.id === rLink);
	if (!rel || rel.targetMode !== "External") return null;
	return rel.target;
};
const getShapeImagePartName = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const rels = slide[INTERNAL_PACKAGE].getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	const resolve = (rEmbed) => {
		if (rEmbed === null) return null;
		const rel = rels.items.find((r) => r.id === rEmbed);
		if (!rel || rel.targetMode === "External") return null;
		return rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
	};
	if (shape[SHAPE_SNAPSHOT].kind === "picture") return resolve(getPictureEmbedRId(shape[SHAPE_ELEMENT]));
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const blipFill = firstChildElement(spPr, qname("a", "blipFill", NS.dml));
	if (!blipFill) return null;
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) return null;
	return resolve(getAttrValue(blip, qname("r", "embed", NS.officeDocRels)));
};
/**
* Returns the bytes of the image used as this shape's *fill*
* (`<a:blipFill>` nested under `<p:spPr>`, as written by
* `setShapeImageFill`). Distinct from `getShapeImageBytes`, which only
* applies to `<p:pic>` picture shapes.
*
* Returns null if the shape has no image fill, the blip has no
* `r:embed`, or the embed points at an external `r:link`.
*/
const getShapeImageFillBytes = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const blipFill = firstChildElement(spPr, qname("a", "blipFill", NS.dml));
	if (!blipFill) return null;
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) return null;
	const rEmbed = getAttrValue(blip, qname("r", "embed", NS.officeDocRels));
	if (rEmbed === null) return null;
	const slide = shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	const rel = rels.items.find((r) => r.id === rEmbed);
	if (!rel || rel.targetMode === "External") return null;
	const mediaName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
	return pkg.getPart(mediaName)?.data ?? null;
};
/**
* Returns the image format token (`'png'`, `'jpeg'`, …) for whichever
* image bytes the shape carries — picture (`<p:pic>`) or image-fill
* (`<a:blipFill>` on `<p:spPr>`). Returns `null` if the shape has no
* embedded image or the bytes don't match a recognized signature.
*/
const getShapeImageFormat = (shape) => {
	const bytes = getShapeImageBytes(shape) ?? getShapeImageFillBytes(shape);
	if (bytes === null) return null;
	return detectImageFormat(bytes);
};
/**
* Reads the picture's opacity (0–1 fraction). Returns `null` when no
* `<a:alphaModFix>` is present (PowerPoint treats absence as fully
* opaque); returns `1` when an explicit alphaModFix sets full opacity.
*/
const getShapeImageOpacity = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") return null;
	const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
	if (!blipFill) return null;
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) return null;
	const alpha = firstChildElement(blip, qname("a", "alphaModFix", NS.dml));
	if (!alpha) return null;
	const amt = getAttrValue(alpha, qname("", "amt", ""));
	if (amt === null) return 1;
	const n = Number.parseInt(amt, 10);
	if (!Number.isFinite(n)) return null;
	return n / 1e5;
};
/**
* Reads the picture's crop fractions. Returns `null` when no
* `<a:srcRect>` is present; otherwise returns a fully-populated object
* with every side filled in (0 for omitted sides on disk).
*/
const getShapeImageCrop = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") return null;
	const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
	if (!blipFill) return null;
	const srcRect = firstChildElement(blipFill, qname("a", "srcRect", NS.dml));
	if (!srcRect) return null;
	const parseSide = (local) => {
		const v = getAttrValue(srcRect, qname("", local, ""));
		if (v === null) return 0;
		const n = Number.parseInt(v, 10);
		return Number.isFinite(n) ? n / 1e5 : 0;
	};
	return {
		left: parseSide("l"),
		top: parseSide("t"),
		right: parseSide("r"),
		bottom: parseSide("b")
	};
};
const NAME_LUM = qname("a", "lum", NS.dml);
const requirePictureBlip = (shape, fnName) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") throw new Error(`${fnName} only works on picture shapes; ${shape[SHAPE_SNAPSHOT].kind} is not one`);
	const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
	if (!blipFill) throw new Error("picture has no <p:blipFill>");
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) throw new Error("picture <p:blipFill> has no <a:blip>");
	return blip;
};
const setLumAttr = (blip, local, value) => {
	let lum = firstChildElement(blip, NAME_LUM);
	if (lum) lum.attrs = lum.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === local));
	if (value !== null && value !== 0) {
		if (!lum) {
			lum = elem(NAME_LUM);
			blip.children.push(lum);
		}
		lum.attrs.push(attr(qname("", local, ""), String(Math.round(value * 1e5))));
	}
	if (lum && lum.attrs.length === 0) blip.children = blip.children.filter((c) => c !== lum);
};
const getLumAttr = (shape, local) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") return null;
	const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
	if (!blipFill) return null;
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) return null;
	const lum = firstChildElement(blip, NAME_LUM);
	if (!lum) return null;
	const v = getAttrValue(lum, qname("", local, ""));
	if (v === null) return null;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? n / 1e5 : null;
};
/**
* Adjusts the picture's brightness via `<a:blip><a:lum bright="…"/>`. The value
* is a -1..1 fraction:
*
*   - `1`     → +100% brightness
*   - `0` or `null` → no brightness change (the `bright` attribute is removed)
*   - `-1`    → -100% brightness
*
* Brightness and contrast share the one `<a:lum>` element, so setting one keeps
* the other. Throws for non-picture shapes and on values outside [-1, 1].
*/
const setShapeImageBrightness = (shape, value) => {
	const blip = requirePictureBlip(shape, "setShapeImageBrightness");
	if (value !== null && value !== 0 && (!Number.isFinite(value) || value < -1 || value > 1)) throw new RangeError(`brightness must be in [-1, 1], got ${value}`);
	setLumAttr(blip, "bright", value);
	commitAndRefresh(shape);
};
/**
* Adjusts the picture's contrast via `<a:blip><a:lum contrast="…"/>`. The value
* is a -1..1 fraction (ECMA-376 `ST_FixedPercentage`):
*
*   - `0` or `null` → no contrast change (the `contrast` attribute is removed)
*   - `0.5`         → +50% contrast (boosted)
*   - `-0.5`        → -50% contrast (washed out)
*
* Brightness and contrast share the one `<a:lum>` element, so setting one keeps
* the other. Throws on non-picture shapes and on values outside [-1, 1].
*/
const setShapeImageContrast = (shape, value) => {
	const blip = requirePictureBlip(shape, "setShapeImageContrast");
	if (value !== null && value !== 0 && (!Number.isFinite(value) || value < -1 || value > 1)) throw new RangeError(`contrast must be in [-1, 1], got ${value}`);
	setLumAttr(blip, "contrast", value);
	commitAndRefresh(shape);
};
/**
* Reads the picture's contrast (the `<a:lum contrast>` fraction in [-1, 1]).
* Returns `null` when no contrast adjustment is present.
*/
const getShapeImageContrast = (shape) => getLumAttr(shape, "contrast");
/**
* Reads the picture's brightness (the `<a:lum bright>` fraction in [-1, 1]).
* Returns `null` when no brightness adjustment is present.
*/
const getShapeImageBrightness = (shape) => getLumAttr(shape, "bright");
const setShapeImageOpacity = (shape, opacity) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") throw new Error(`setShapeImageOpacity only works on picture shapes; ${shape[SHAPE_SNAPSHOT].kind} is not one`);
	const blipFill = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "blipFill", NS.pml));
	if (!blipFill) throw new Error("picture has no <p:blipFill>");
	const blip = firstChildElement(blipFill, qname("a", "blip", NS.dml));
	if (!blip) throw new Error("picture <p:blipFill> has no <a:blip>");
	blip.children = blip.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "alphaModFix"));
	if (opacity !== null) {
		if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError(`opacity must be in [0, 1], got ${opacity}`);
		blip.children.push(elem(NAME_ALPHA_MOD_FIX_FN, { attrs: [attr(ATTR_AMT_FN, String(Math.round(opacity * 1e5)))] }));
	}
	commitAndRefresh(shape);
};
const NAME_BLIP_FILL_FN = qname("p", "blipFill", NS.pml);
const NAME_SRC_RECT_FN = qname("a", "srcRect", NS.dml);
NS.dml;
const ATTR_CROP_L = qname("", "l", "");
const ATTR_CROP_T = qname("", "t", "");
const ATTR_CROP_R = qname("", "r", "");
const ATTR_CROP_B = qname("", "b", "");
const fractionToST = (n) => {
	if (n === void 0 || n === 0) return null;
	if (!Number.isFinite(n) || n < 0 || n >= 1) throw new RangeError(`crop fraction must be in [0, 1), got ${n}`);
	return String(Math.round(n * 1e5));
};
/**
* Sets (or clears) a `<a:srcRect>` on a picture shape, cropping the
* embedded image by the given fraction on each side. Pass `null` to
* remove an existing crop.
*
* Fractions are in `[0, 1)` per side. `{ left: 0.25 }` clips 25% off
* the left edge; the visible image stretches to fill the original
* frame. The shape's geometry (`<a:xfrm>`) is unchanged.
*/
const setShapeImageCrop = (shape, crop) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") throw new Error(`setShapeImageCrop only works on picture shapes; ${shape[SHAPE_SNAPSHOT].kind} is not one`);
	const pic = shape[SHAPE_ELEMENT];
	const blipFill = firstChildElement(pic, NAME_BLIP_FILL_FN);
	if (!blipFill) throw new Error("picture has no <p:blipFill>");
	blipFill.children = blipFill.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "srcRect"));
	if (crop === null) {
		commitAndRefresh(shape);
		return;
	}
	const attrs = [];
	const l = fractionToST(crop.left);
	const t = fractionToST(crop.top);
	const r = fractionToST(crop.right);
	const b = fractionToST(crop.bottom);
	if (l !== null) attrs.push(attr(ATTR_CROP_L, l));
	if (t !== null) attrs.push(attr(ATTR_CROP_T, t));
	if (r !== null) attrs.push(attr(ATTR_CROP_R, r));
	if (b !== null) attrs.push(attr(ATTR_CROP_B, b));
	const srcRect = elem(NAME_SRC_RECT_FN, { attrs });
	const blipIdx = blipFill.children.findIndex((c) => c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "blip");
	if (blipIdx === -1) blipFill.children.unshift(srcRect);
	else blipFill.children.splice(blipIdx + 1, 0, srcRect);
	commitAndRefresh(shape);
};
//#endregion
//#region src/api/fn/_media-timing.ts
const NAME_TIMING = qname("p", "timing", NS.pml);
const NAME_TN_LST = qname("p", "tnLst", NS.pml);
const NAME_PAR = qname("p", "par", NS.pml);
const NAME_C_TN = qname("p", "cTn", NS.pml);
const NAME_CHILD_TN_LST = qname("p", "childTnLst", NS.pml);
const NAME_EXT_LST$1 = qname("p", "extLst", NS.pml);
const ATTR_ID = qname("", "id", "");
const findSlideTiming = (slide) => firstChildElement(slide[SLIDE_DOCUMENT].root, NAME_TIMING);
const insertSlideTiming = (slide, timing) => {
	const root = slide[SLIDE_DOCUMENT].root;
	const extLst = firstChildElement(root, NAME_EXT_LST$1);
	if (extLst === null) root.children.push(timing);
	else root.children.splice(root.children.indexOf(extLst), 0, timing);
};
/** The root time node's `<p:childTnLst>` — where media nodes and sequences live. */
const rootChildTnLst = (timing) => {
	const tnLst = firstChildElement(timing, NAME_TN_LST);
	const par = tnLst ? firstChildElement(tnLst, NAME_PAR) : null;
	const cTn = par ? firstChildElement(par, NAME_C_TN) : null;
	return cTn ? firstChildElement(cTn, NAME_CHILD_TN_LST) : null;
};
const maxCTnId = (el) => {
	let max = 0;
	const walk = (e) => {
		if (e.name.namespaceURI === NS.pml && e.name.localName === "cTn") {
			const n = Number.parseInt(getAttrValue(e, ATTR_ID) ?? "", 10);
			if (Number.isFinite(n) && n > max) max = n;
		}
		for (const c of e.children) if (c.kind === "element") walk(c);
	};
	walk(el);
	return max;
};
/** Adds the media time node for shape `spid`. The caller commits the slide. */
const addMediaTimingNode = (slide, kind, spid) => {
	const timing = findSlideTiming(slide);
	if (timing === null) {
		insertSlideTiming(slide, buildTimingRoot([buildMediaTimingNode(kind, spid, 2)]));
		return;
	}
	const node = buildMediaTimingNode(kind, spid, maxCTnId(timing) + 1);
	const childTnLst = rootChildTnLst(timing);
	if (childTnLst !== null) {
		childTnLst.children.push(node);
		return;
	}
	const fresh = buildTimingRoot([node]);
	const rest = timing.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "tnLst"));
	timing.children = [...fresh.children, ...rest];
};
/**
* Removes the media nodes targeting any of `spids`, and the whole `<p:timing>`
* when that leaves the root without children (an empty `<p:childTnLst>` is
* schema-invalid and an empty root animates nothing). The caller commits.
*/
const removeMediaTimingNodes = (slide, spids) => {
	const timing = findSlideTiming(slide);
	const childTnLst = timing ? rootChildTnLst(timing) : null;
	if (timing === null || childTnLst === null) return;
	childTnLst.children = childTnLst.children.filter((c) => {
		if (c.kind !== "element" || !isMediaTimingNode(c)) return true;
		const target = mediaTimingNodeTarget(c);
		return target === null || !spids.has(target);
	});
	if (!childTnLst.children.some((c) => c.kind === "element")) {
		const root = slide[SLIDE_DOCUMENT].root;
		root.children = root.children.filter((c) => c !== timing);
	}
};
/** Media nodes at the timing root, in document order. */
const mediaTimingNodes = (timing) => {
	const childTnLst = rootChildTnLst(timing);
	if (childTnLst === null) return [];
	return childTnLst.children.filter((c) => c.kind === "element" && isMediaTimingNode(c));
};
//#endregion
//#region src/api/fn/shape-animation.ts
NS.pml;
const ATTR_ID_FN = qname("", "id", "");
const removeExistingTiming = (slide) => {
	slide[SLIDE_DOCUMENT].root.children = slide[SLIDE_DOCUMENT].root.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "timing"));
};
const findTiming = (slide) => slide[SLIDE_DOCUMENT].root.children.find((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "timing") ?? null;
const insertTimingAtEnd = (slide, timing) => {
	slide[SLIDE_DOCUMENT].root.children.push(timing);
};
const findDescendant = (el, pred) => {
	if (pred(el)) return el;
	for (const c of el.children) if (c.kind === "element") {
		const found = findDescendant(c, pred);
		if (found) return found;
	}
	return null;
};
const isPml = (el, local) => el.name.namespaceURI === NS.pml && el.name.localName === local;
const shiftCTnIds = (el, offset) => {
	const walk = (e) => {
		if (isPml(e, "cTn")) {
			const raw = getAttrValue(e, ATTR_ID_FN);
			const n = raw === null ? NaN : Number.parseInt(raw, 10);
			if (Number.isFinite(n)) e.attrs = e.attrs.map((a) => a.name.namespaceURI === "" && a.name.localName === "id" ? {
				...a,
				value: String(n + offset)
			} : a);
		}
		for (const c of e.children) if (c.kind === "element") walk(c);
	};
	walk(el);
};
const maxGrpId = (el) => {
	let max = -1;
	const walk = (e) => {
		const raw = getAttrValue(e, qname("", "grpId", ""));
		if (raw !== null) {
			const n = Number.parseInt(raw, 10);
			if (Number.isFinite(n) && n > max) max = n;
		}
		for (const c of e.children) if (c.kind === "element") walk(c);
	};
	walk(el);
	return max;
};
const setGrpId = (el, grpId) => {
	el.attrs = el.attrs.map((a) => a.name.namespaceURI === "" && a.name.localName === "grpId" ? {
		...a,
		value: grpId
	} : a);
};
const isMainSeqCTn = (e) => isPml(e, "cTn") && getAttrValue(e, qname("", "nodeType", "")) === "mainSeq";
const mergeEffectInto = (existing, fresh) => {
	const freshMainSeq = findDescendant(fresh, isMainSeqCTn);
	const freshChildTnLst = freshMainSeq ? firstChildElement(freshMainSeq, qname("p", "childTnLst", NS.pml)) : null;
	const newPar = freshChildTnLst ? freshChildTnLst.children.find((c) => c.kind === "element" && isPml(c, "par")) : null;
	const freshBldP = findDescendant(fresh, (e) => isPml(e, "bldP"));
	if (!newPar || !freshBldP) return false;
	const newGrpId = String(maxGrpId(existing) + 1);
	const effectCTn = findDescendant(newPar, (e) => getAttrValue(e, qname("", "presetID", "")) !== null);
	const existingMainSeq = findDescendant(existing, isMainSeqCTn);
	const existingMainSeqChildTnLst = existingMainSeq ? firstChildElement(existingMainSeq, qname("p", "childTnLst", NS.pml)) : null;
	if (existingMainSeqChildTnLst) {
		const offset = maxCTnId(existing) - 2;
		if (offset > 0) shiftCTnIds(newPar, offset);
		existingMainSeqChildTnLst.children.push(newPar);
	} else {
		const rootList = rootChildTnLst(existing);
		const freshSeq = rootChildTnLst(fresh)?.children.find((c) => c.kind === "element" && isPml(c, "seq"));
		if (!rootList || !freshSeq) return false;
		shiftCTnIds(freshSeq, maxCTnId(existing) - 1);
		rootList.children.unshift(freshSeq);
	}
	if (effectCTn) setGrpId(effectCTn, newGrpId);
	setGrpId(freshBldP, newGrpId);
	const existingBldLst = findDescendant(existing, (e) => isPml(e, "bldLst"));
	if (existingBldLst) existingBldLst.children.push(freshBldP);
	else insertBldLst(existing, elem(qname("p", "bldLst", NS.pml), { children: [freshBldP] }));
	return true;
};
const insertBldLst = (timing, bldLst) => {
	const extLst = firstChildElement(timing, qname("p", "extLst", NS.pml));
	if (extLst === null) timing.children.push(bldLst);
	else timing.children.splice(timing.children.indexOf(extLst), 0, bldLst);
};
/**
* Sets a single click-triggered animation effect on the given shape.
*
* The effect is *merged* into any existing `<p:timing>` on the slide rather
* than replacing it: animating a second shape (or re-running on a template that
* already has authored animations) preserves the existing effects and appends
* this one as the next click stop, with cTn ids renumbered to stay unique. To
* clear every animation first, call `clearSlideAnimations`.
*
* Supported `effect` tokens:
*
*   - `'fadeIn'`   entrance fade
*   - `'fadeOut'`  exit fade
*   - `'appear'`   instant entrance
*   - `'disappear'` instant exit
*
* `durationMs` defaults to 500ms (fades only — `appear`/`disappear`
* are instantaneous).
*/
const setShapeAnimation = (shape, opts) => {
	const slide = shape[SHAPE_SLIDE];
	const spid = shape[SHAPE_SNAPSHOT].id;
	const fresh = buildSingleEffectTiming(spid, opts);
	const existing = findTiming(slide);
	if (existing === null) insertTimingAtEnd(slide, fresh);
	else if (!mergeEffectInto(existing, fresh)) throw new Error("setShapeAnimation: the slide already has an animation timing tree this single-effect API cannot safely extend. Call clearSlideAnimations(slide) first to reset it.");
	commitSlideData(slide);
	refreshSlideData(slide);
};
/**
* Returns the animation effect bound to this shape via the slide's
* `<p:timing>` tree, or `null` if the shape has no animation in the
* v1 single-effect schema we model. Unknown presets are reported as a
* raw `null` rather than guessing.
*/
const getShapeAnimation = (shape) => {
	const timing = shape[SHAPE_SLIDE][SLIDE_DOCUMENT].root.children.find((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "timing");
	if (!timing) return null;
	const bldLst = firstChildElement(timing, qname("p", "bldLst", NS.pml));
	if (!bldLst) return null;
	const spidStr = String(shape[SHAPE_SNAPSHOT].id);
	if (!allChildElements(bldLst, qname("p", "bldP", NS.pml)).some((b) => getAttrValue(b, qname("", "spid", "")) === spidStr)) return null;
	let presetID = null;
	let presetClass = null;
	const walk = (el) => {
		if (el.name.namespaceURI === NS.pml && el.name.localName === "cTn") {
			const cls = getAttrValue(el, qname("", "presetClass", ""));
			const id = getAttrValue(el, qname("", "presetID", ""));
			if (cls && id) {
				const targetsShape = (sub) => {
					if (sub.name.namespaceURI === NS.pml && sub.name.localName === "spTgt" && getAttrValue(sub, qname("", "spid", "")) === spidStr) return true;
					for (const c of sub.children) if (c.kind === "element" && targetsShape(c)) return true;
					return false;
				};
				if (targetsShape(el)) {
					presetClass = cls;
					presetID = id;
					return true;
				}
			}
		}
		for (const c of el.children) if (c.kind === "element" && walk(c)) return true;
		return false;
	};
	walk(timing);
	if (!presetID || !presetClass) return null;
	const id = Number.parseInt(presetID, 10);
	if (presetClass === "entr" && id === 1) return "appear";
	if (presetClass === "entr" && id === 10) return "fadeIn";
	if (presetClass === "exit" && id === 1) return "disappear";
	if (presetClass === "exit" && id === 10) return "fadeOut";
	return null;
};
/** Removes the slide's `<p:timing>` element entirely. */
/**
* Returns every shape on the slide that has an authored animation
* effect (i.e. `getShapeAnimation(shape)` is not `null`). Pair to
* `slideHasAnimations`. Useful for audit reports — "which shapes on
* this slide actually animate?" before exporting to a video pipeline
* that doesn't honor PowerPoint's timing tree.
*/
const findShapesWithAnimation = (slide) => {
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) if (getShapeAnimation(shape) !== null) out.push(shape);
	return out;
};
const clearSlideAnimations = (slide) => {
	const existing = findTiming(slide);
	const mediaNodes = existing ? mediaTimingNodes(existing) : [];
	if (existing !== null && mediaNodes.length > 0) {
		const root = slide[SLIDE_DOCUMENT].root;
		root.children[root.children.indexOf(existing)] = buildTimingRoot(mediaNodes);
	} else removeExistingTiming(slide);
	commitSlideData(slide);
	refreshSlideData(slide);
};
//#endregion
//#region src/api/fn/slide-title.ts
/**
* Returns the slide's title text, or `null` if neither a `title` nor
* a `ctrTitle` placeholder is present.
*/
const getSlideTitle = (slide) => {
	const titleShape = findSlidePlaceholder(slide, "title") ?? findSlidePlaceholder(slide, "ctrTitle");
	if (titleShape === null) return null;
	return titleShape[SHAPE_SNAPSHOT].text ?? null;
};
/**
* Returns the slide's body text, or `null` if no `body` placeholder
* is present. Mirror of `getSlideTitle`; pairs with `setSlideBody`.
*/
const getSlideBody = (slide) => {
	const bodyShape = findSlidePlaceholder(slide, "body");
	if (bodyShape === null) return null;
	return bodyShape[SHAPE_SNAPSHOT].text ?? null;
};
/**
* Sets the slide's title text. Looks for a `title` placeholder first,
* falling back to `ctrTitle`. Throws if neither exists — the slide's
* layout has no title slot.
*/
const setSlideTitle = (slide, title) => {
	const titleShape = findSlidePlaceholder(slide, "title") ?? findSlidePlaceholder(slide, "ctrTitle");
	if (titleShape === null) throw new Error("setSlideTitle: slide has no title / ctrTitle placeholder");
	setShapeText(titleShape, title);
};
/**
* Bulk-fills slide placeholders by type token. Each entry in
* `byType` maps a `<p:ph type>` token (e.g. `'title'`, `'body'`,
* `'ftr'`, `'dt'`) to the text to set. Silently skips entries
* whose placeholder isn't present on the slide.
*
* Useful for template-fill workflows where the caller has all the
* data in one struct.
*/
const setSlidePlaceholders = (slide, byType) => {
	for (const [type, text] of Object.entries(byType)) {
		const shape = type === "title" ? findSlidePlaceholder(slide, "title") ?? findSlidePlaceholder(slide, "ctrTitle") : findSlidePlaceholder(slide, type);
		if (shape !== null) setShapeText(shape, text);
	}
};
/**
* Writes `text` into the first body placeholder on the slide.
* Newlines start a new paragraph (each becomes its own bullet on
* layouts that bullet their body placeholder).
*
* Throws when the slide has no body placeholder — pair with
* `findSlideLayoutByType(pres, 'obj')` / `'tx'` to add the slide
* onto a layout that has one.
*/
const setSlideBody = (slide, text) => {
	const bodyShape = findSlidePlaceholder(slide, "body");
	if (bodyShape === null) throw new Error("setSlideBody: slide has no body placeholder");
	setShapeText(bodyShape, text);
};
//#endregion
//#region src/api/fn/shape-runs.ts
const NAME_TX_BODY$1 = qname("p", "txBody", NS.pml);
const NAME_A_P = qname("a", "p", NS.dml);
const NAME_A_R = qname("a", "r", NS.dml);
const NAME_A_RPR = qname("a", "rPr", NS.dml);
const NAME_A_T = qname("a", "t", NS.dml);
const NAME_A_END_PARA_RPR = qname("a", "endParaRPr", NS.dml);
const paragraphsOf = (txBody) => txBody.children.filter((c) => c.kind === "element" && c.name.namespaceURI === NAME_A_P.namespaceURI && c.name.localName === "p");
const runsOf = (paragraph) => paragraph.children.filter((c) => c.kind === "element" && c.name.namespaceURI === NAME_A_R.namespaceURI && c.name.localName === "r");
const requireParagraph = (shape, paragraphIndex) => {
	const paragraphs = paragraphsOf(requireTxBody(shape));
	const paragraph = paragraphs[paragraphIndex];
	if (!paragraph) throw new RangeError(`paragraph index ${paragraphIndex} out of range (have ${paragraphs.length})`);
	return paragraph;
};
const requireRun = (shape, paragraphIndex, runIndex) => {
	const runs = runsOf(requireParagraph(shape, paragraphIndex));
	const run = runs[runIndex];
	if (!run) throw new RangeError(`run index ${runIndex} out of range in paragraph ${paragraphIndex} (have ${runs.length})`);
	return run;
};
const ensureRPr = (run) => {
	const existing = firstChildElement(run, NAME_A_RPR);
	if (existing !== null) return existing;
	const fresh = elem(NAME_A_RPR);
	run.children.unshift(fresh);
	return fresh;
};
const readRunText = (run) => {
	const tEl = firstChildElement(run, NAME_A_T);
	if (tEl === null) return "";
	let out = "";
	for (const child of tEl.children) if (child.kind === "text" || child.kind === "cdata") out += child.data;
	return out;
};
const writeRunText = (run, value) => {
	let tEl = firstChildElement(run, NAME_A_T);
	if (tEl === null) {
		tEl = elem(NAME_A_T);
		run.children.push(tEl);
	}
	tEl.children = [{
		kind: "text",
		data: value
	}];
};
/** Number of paragraphs in the shape's text body. Throws for non-text shapes. */
const getShapeParagraphCount = (shape) => paragraphsOf(requireTxBody(shape)).length;
/**
* Returns the inline children of a paragraph in document order — runs,
* field placeholders, and line breaks. Used by renderers that need to
* reproduce the paragraph faithfully (the `<a:r>`-only run accessors
* silently drop fields and breaks).
*/
const getShapeParagraphElements = (shape, paragraphIndex) => readParagraphElements(requireParagraph(shape, paragraphIndex));
/**
* Reads the literal format of a paragraph's end mark (`<a:endParaRPr>`), or
* `null` when the paragraph carries none. It is the only format a paragraph
* with no runs carries. The write side is `setShapeParagraphs`' `endFormat`.
*/
const getParagraphEndFormat = (shape, paragraphIndex) => readParagraphEndFormat(requireParagraph(shape, paragraphIndex));
/**
* Shared by the shape reader above and the table-cell paragraph reader.
*
* @internal
*/
const readParagraphEndFormat = (paragraph) => {
	const endParaRPr = firstChildElement(paragraph, NAME_A_END_PARA_RPR);
	return endParaRPr === null ? null : parseRPrLikeElement(endParaRPr);
};
/**
* Walks a single `<a:p>` element and returns its inline children in
* document order. Shared by the shape-text reader above and the table-cell
* text reader: both use the identical DrawingML run/field/break grammar, so
* only the way the paragraph element is located differs.
*
* @internal
*/
const readParagraphElements = (paragraph) => {
	const out = [];
	const readT = (parent) => {
		const tEl = firstChildElement(parent, NAME_A_T);
		if (!tEl) return "";
		let acc = "";
		for (const c of tEl.children) if (c.kind === "text" || c.kind === "cdata") acc += c.data;
		return acc;
	};
	const readFmt = (parent) => {
		const rPr = firstChildElement(parent, NAME_A_RPR);
		if (!rPr) return null;
		return parseRPrLikeElement(rPr);
	};
	for (const child of paragraph.children) {
		if (child.kind !== "element" || child.name.namespaceURI !== NS.dml) continue;
		if (child.name.localName === "r") out.push({
			kind: "r",
			text: readT(child),
			format: readFmt(child)
		});
		else if (child.name.localName === "fld") {
			const type = getAttrValue(child, qname("", "type", ""));
			out.push({
				kind: "fld",
				text: readT(child),
				format: readFmt(child),
				type
			});
		} else if (child.name.localName === "br") out.push({
			kind: "br",
			format: readFmt(child)
		});
	}
	return out;
};
/**
* Number of text runs in the given paragraph. Throws on out-of-range
* paragraph index or non-text shapes.
*/
const getShapeRunCount = (shape, paragraphIndex) => runsOf(requireParagraph(shape, paragraphIndex)).length;
/** Visible text of a single run. */
const getShapeRunText = (shape, paragraphIndex, runIndex) => readRunText(requireRun(shape, paragraphIndex, runIndex));
/**
* Sets `<a:hlinkClick>` on a single run. Per-run counterpart to
* `setShapeHyperlink` (which targets every run in the shape). Pass
* `null` to clear the link on that run alone — other runs are
* untouched. Allocates or reuses a hyperlink rel on the slide
* exactly like the shape-level setter.
*/
const setShapeRunHyperlink = (shape, paragraphIndex, runIndex, url, tooltip) => {
	const run = requireRun(shape, paragraphIndex, runIndex);
	let rPr = firstChildElement(run, qname("a", "rPr", NS.dml));
	if (rPr === null) {
		rPr = elem(qname("a", "rPr", NS.dml));
		run.children.unshift(rPr);
	}
	rPr.children = rPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "hlinkClick"));
	if (url !== null) {
		const slide = shape[SHAPE_SLIDE];
		const pkg = slide[INTERNAL_PACKAGE];
		const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
		const existing = rels.items.find((r) => r.type === REL_TYPES.hyperlink && r.target === url && r.targetMode === "External");
		let rId;
		if (existing) rId = existing.id;
		else {
			rId = nextRelId(rels.items.map((r) => r.id));
			rels.items.push({
				id: rId,
				type: REL_TYPES.hyperlink,
				target: url,
				targetMode: "External"
			});
			pkg.setRels(slide[SLIDE_PART_NAME], rels);
		}
		const hlinkAttrs = [attr(qname("r", "id", NS.officeDocRels), rId)];
		if (tooltip !== void 0) hlinkAttrs.push(attr(qname("", "tooltip", ""), tooltip));
		rPr.children.push(elem(qname("a", "hlinkClick", NS.dml), { attrs: hlinkAttrs }));
	}
	commitAndRefresh(shape);
	releaseUnusedLinkRels(shape[SHAPE_SLIDE]);
};
/**
* Reads the external URL on a single run's `<a:hlinkClick>`. Per-run
* counterpart to `getShapeHyperlink` (which only surfaces the first
* link it finds). Returns `null` when this run has no link, or the
* link's `r:id` resolves to a non-hyperlink rel.
*/
const getShapeRunHyperlink = (shape, paragraphIndex, runIndex) => {
	const rPr = firstChildElement(requireRun(shape, paragraphIndex, runIndex), qname("a", "rPr", NS.dml));
	if (!rPr) return null;
	const hlink = firstChildElement(rPr, qname("a", "hlinkClick", NS.dml));
	if (!hlink) return null;
	const rId = getAttrValue(hlink, qname("r", "id", NS.officeDocRels));
	if (!rId) return null;
	const slide = shape[SHAPE_SLIDE];
	const rels = slide[INTERNAL_PACKAGE].getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	const rel = rels.items.find((x) => x.id === rId);
	if (rel?.type === REL_TYPES.hyperlink && rel.targetMode === "External") return rel.target;
	return null;
};
/**
* Reads the tooltip text on the shape's `<a:hlinkClick tooltip="…"/>`.
* Returns `null` when no hyperlink is set or the link doesn't author
* a tooltip. Tooltips show up in PowerPoint when the user hovers over
* a linked shape in slide-show mode.
*
* Scans run-level `<a:rPr><a:hlinkClick>` first (where
* `setShapeHyperlink` writes) and falls back to the
* `<p:nvSpPr><p:cNvPr><a:hlinkClick>` shape-click hyperlink. Mirrors
* `getShapeHyperlink`'s read path so the writer / reader pair is
* consistent.
*/
const getShapeHyperlinkTooltip = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind === "shape") {
		const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY$1);
		if (txBody) for (const p of txBody.children) {
			if (p.kind !== "element" || p.name.namespaceURI !== NS.dml || p.name.localName !== "p") continue;
			for (const r of p.children) {
				if (r.kind !== "element" || r.name.namespaceURI !== NS.dml || r.name.localName !== "r") continue;
				const rPr = firstChildElement(r, qname("a", "rPr", NS.dml));
				if (!rPr) continue;
				const hlink = firstChildElement(rPr, qname("a", "hlinkClick", NS.dml));
				if (!hlink) continue;
				const tt = getAttrValue(hlink, qname("", "tooltip", ""));
				if (tt !== null) return tt;
			}
		}
	}
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) return null;
	const hlink = firstChildElement(cNvPr, NAME_HLINK_CLICK_FN);
	if (!hlink) return null;
	return getAttrValue(hlink, qname("", "tooltip", "")) ?? null;
};
/**
* Reads the tooltip on a per-run `<a:rPr><a:hlinkClick tooltip="…"/>`.
* Same semantics as `getShapeHyperlinkTooltip` but scoped to a single
* run.
*/
const getShapeRunHyperlinkTooltip = (shape, paragraphIndex, runIndex) => {
	const rPr = firstChildElement(requireRun(shape, paragraphIndex, runIndex), qname("a", "rPr", NS.dml));
	if (!rPr) return null;
	const hlink = firstChildElement(rPr, qname("a", "hlinkClick", NS.dml));
	if (!hlink) return null;
	return getAttrValue(hlink, qname("", "tooltip", "")) ?? null;
};
/**
* Same as `getShapeClickAction` but reads the per-run
* `<a:rPr><a:hlinkClick action=… r:id=…/>`. Recognises:
*
*   - `{ kind: 'url', url }` — external hyperlink rel
*   - `{ kind: 'slide', slide }` — slide-jump action + slide rel
*   - `{ kind: 'nextSlide' | 'prevSlide' | 'firstSlide' | 'lastSlide' }`
*
* Returns `null` for runs without an action or unknown action tokens.
*/
const getShapeRunClickAction = (shape, paragraphIndex, runIndex) => {
	const rPr = firstChildElement(requireRun(shape, paragraphIndex, runIndex), qname("a", "rPr", NS.dml));
	if (!rPr) return null;
	const hlink = firstChildElement(rPr, qname("a", "hlinkClick", NS.dml));
	if (!hlink) return null;
	const action = getAttrValue(hlink, qname("", "action", ""));
	const rId = getAttrValue(hlink, qname("r", "id", NS.officeDocRels));
	if (action === "ppaction://hlinkshowjump?jump=nextslide") return { kind: "nextSlide" };
	if (action === "ppaction://hlinkshowjump?jump=previousslide") return { kind: "prevSlide" };
	if (action === "ppaction://hlinkshowjump?jump=firstslide") return { kind: "firstSlide" };
	if (action === "ppaction://hlinkshowjump?jump=lastslide") return { kind: "lastSlide" };
	if (rId === null || rId === "") return null;
	const slide = shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	const rel = rels.items.find((r) => r.id === rId);
	if (!rel) return null;
	if (action === "ppaction://hlinksldjump" && rel.type === REL_TYPES.slide) {
		const targetPartName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
		const pres = {
			[INTERNAL_PACKAGE]: pkg,
			_slidesCache: null
		};
		for (const candidate of getSlides(pres)) if (candidate[SLIDE_PART_NAME] === targetPartName) return {
			kind: "slide",
			slide: candidate
		};
		return null;
	}
	if (rel.type === REL_TYPES.hyperlink && rel.targetMode === "External") return {
		kind: "url",
		url: rel.target
	};
	return null;
};
const NAME_A_PPR = qname("a", "pPr", NS.dml);
const ATTR_LVL = qname("", "lvl", "");
const ATTR_ALGN_FN = qname("", "algn", "");
const ensurePPr = (paragraph) => {
	const existing = firstChildElement(paragraph, NAME_A_PPR);
	if (existing !== null) return existing;
	const fresh = elem(NAME_A_PPR);
	paragraph.children.unshift(fresh);
	return fresh;
};
/**
* Sets the horizontal alignment of a single paragraph. Same token set
* as `setShapeAlignment`. Other paragraphs are untouched.
*/
const setParagraphAlignment = (shape, paragraphIndex, align) => {
	const token = alignToken(align, "setParagraphAlignment");
	const pPr = ensurePPr(requireParagraph(shape, paragraphIndex));
	pPr.attrs = pPr.attrs.filter((a) => a.name.localName !== "algn");
	pPr.attrs.push(attr(ATTR_ALGN_FN, token));
	commitAndRefresh(shape);
};
/**
* Sets the paragraph's nesting level (`<a:pPr lvl="N"/>`). Levels are
* 0-indexed; PowerPoint accepts 0 through 8. Pass `0` to clear an
* existing level — `<a:pPr lvl="0"/>` is the same as omitting the attr.
* Indents matching the previous level's default bullet pair follow the level;
* other indent values are preserved.
*
* Used in tandem with bullets to author nested lists:
*
*   setShapeText(shape, 'Item 1\nNested\nItem 2');
*   setShapeBulletStyle(shape, 'bullet');
*   setParagraphLevel(shape, 1, 1);  // indent the second line
*/
const setParagraphLevel = (shape, paragraphIndex, level) => {
	if (!Number.isInteger(level) || level < 0 || level > 8) throw new RangeError(`paragraph level must be an integer in [0, 8], got ${level}`);
	const pPr = ensurePPr(requireParagraph(shape, paragraphIndex));
	const previousLevel = Number.parseInt(getAttrValue(pPr, ATTR_LVL) ?? "0", 10);
	pPr.attrs = pPr.attrs.filter((a) => a.name.localName !== "lvl");
	if (level > 0) pPr.attrs.push(attr(ATTR_LVL, String(level)));
	updateBulletIndentForLevel(pPr, Number.isFinite(previousLevel) ? previousLevel : 0, level);
	commitAndRefresh(shape);
};
/**
* Reads the paragraph's own `algn` as its spec token (`l`, `ctr`, `r`,
* `just`, `dist`, `justLow`, `thaiDist`) — so `setParagraphAlignment(…,
* 'center')` reads back as `'ctr'`. Returns `null` when the attribute is
* absent (the paragraph inherits from its layout / master) or is not a
* valid token. For the inherited value under a plain-English name, use
* `getParagraphPropertiesEffective`.
*/
const getParagraphAlignment = (shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (pPr === null) return null;
	return parseAlignmentToken(getAttrValue(pPr, ATTR_ALGN_FN));
};
/**
* Reads the paragraph's nesting level (`lvl` attribute), or `0` when
* absent — PowerPoint's default. Returns `null` for non-existent
* paragraphs.
*/
const getParagraphLevel = (shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (pPr === null) return 0;
	const v = getAttrValue(pPr, ATTR_LVL);
	if (v === null) return 0;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : 0;
};
const PPR_CHILD_RANK = {
	lnSpc: 0,
	spcBef: 1,
	spcAft: 2,
	buClrTx: 3,
	buClr: 3,
	buSzTx: 4,
	buSzPct: 4,
	buSzPts: 4,
	buFontTx: 5,
	buFont: 5,
	buNone: 6,
	buAutoNum: 6,
	buChar: 6,
	tabLst: 7,
	defRPr: 8,
	extLst: 9
};
const pPrChildRank = (el) => el.name.namespaceURI === NS.dml ? PPR_CHILD_RANK[el.name.localName] ?? 99 : 99;
/**
* Sets the spacing before and/or after a paragraph, in points (where
* a "point" is 1/72 inch). PowerPoint stores these as hundredths of a
* point inside `<a:pPr><a:spcBef>/<a:spcAft><a:spcPts val="…"/>` —
* the helper converts.
*
*   setParagraphSpacing(shape, 0, { beforePts: 6, afterPts: 3 });
*
* Omitting a side keeps the existing value (or layout default).
* Passing a side as `null` removes that spacing element.
*/
const setParagraphSpacing = (shape, paragraphIndex, opts) => {
	const pPr = ensurePPr(requireParagraph(shape, paragraphIndex));
	const writeSide = (localName, value) => {
		if (value === void 0) return;
		pPr.children = pPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === localName));
		if (value === null) return;
		if (!Number.isFinite(value) || value < 0) throw new RangeError(`paragraph ${localName} must be a non-negative number, got ${value}`);
		insertChildByRank(pPr, elem(qname("a", localName, NS.dml), { children: [elem(qname("a", "spcPts", NS.dml), { attrs: [attr(qname("", "val", ""), String(Math.round(value * 100)))] })] }), pPrChildRank);
	};
	writeSide("spcBef", opts.beforePts);
	writeSide("spcAft", opts.afterPts);
	commitAndRefresh(shape);
};
/**
* Reads back paragraph spacing in points. Returns `{ beforePts,
* afterPts }`; each side is `null` when no `<a:spcBef>` / `<a:spcAft>`
* is present or when the inner element isn't `<a:spcPts>` (percentage
* spacing is reported as `null` for now).
*/
const getParagraphSpacing = (shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (!pPr) return {
		beforePts: null,
		afterPts: null
	};
	const readSide = (localName) => {
		const side = firstChildElement(pPr, qname("a", localName, NS.dml));
		if (!side) return null;
		const spcPts = firstChildElement(side, qname("a", "spcPts", NS.dml));
		if (!spcPts) return null;
		const v = getAttrValue(spcPts, qname("", "val", ""));
		if (v === null) return null;
		const n = Number.parseInt(v, 10);
		return Number.isFinite(n) ? n / 100 : null;
	};
	return {
		beforePts: readSide("spcBef"),
		afterPts: readSide("spcAft")
	};
};
/**
* Reads the paragraph's left / right / first-line indents from
* `<a:pPr marL="…" marR="…" indent="…"/>`. Each is in EMU (matching
* PowerPoint's internal storage); positive means a positive indent,
* negative `indent` is a hanging indent (typical for bullets).
*
* Returns `null` for sides the paragraph doesn't set (those inherit
* from the layout / master).
*/
const getParagraphIndent = (shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (!pPr) return {
		leftEmu: null,
		rightEmu: null,
		firstLineEmu: null
	};
	const read = (name) => {
		const raw = getAttrValue(pPr, qname("", name, ""));
		if (raw === null) return null;
		const n = Number.parseInt(raw, 10);
		return Number.isFinite(n) ? n : null;
	};
	return {
		leftEmu: read("marL"),
		rightEmu: read("marR"),
		firstLineEmu: read("indent")
	};
};
/**
* Reads the paragraph's `<a:lnSpc>` line spacing. PowerPoint stores
* line spacing two ways:
*
*   - Multiple of the natural line height — `<a:spcPct val="150000"/>`
*     (= 1.5×). Returns `{ kind: 'pct', value }` with value as the unit
*     fraction (1.5).
*   - Fixed points — `<a:spcPts val="2400"/>` (= 24pt). Returns
*     `{ kind: 'pts', value }` with value in points.
*
* Returns `null` when no `<a:lnSpc>` is present (the paragraph
* inherits line spacing from the layout / master).
*/
const getParagraphLineSpacing = (shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (!pPr) return null;
	const lnSpc = firstChildElement(pPr, qname("a", "lnSpc", NS.dml));
	if (!lnSpc) return null;
	const pct = firstChildElement(lnSpc, qname("a", "spcPct", NS.dml));
	if (pct) {
		const v = getAttrValue(pct, qname("", "val", ""));
		if (v !== null) {
			let n = Number.parseFloat(v);
			if (Number.isFinite(n)) {
				if (Math.abs(n) > 1) n = n / 1e5;
				return {
					kind: "pct",
					value: n
				};
			}
		}
	}
	const pts = firstChildElement(lnSpc, qname("a", "spcPts", NS.dml));
	if (pts) {
		const v = getAttrValue(pts, qname("", "val", ""));
		if (v !== null) {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n)) return {
				kind: "pts",
				value: n / 100
			};
		}
	}
	return null;
};
/**
* Sets a paragraph's line spacing — the writer counterpart to
* `getParagraphLineSpacing`. Two modes (mirroring `<a:lnSpc>`):
*
*   - `{ kind: 'pct', value }` — a multiple of single spacing
*     (`1` = single, `1.5` = 150%, `2` = double) → `<a:spcPct>`.
*   - `{ kind: 'pts', value }` — a fixed leading in points → `<a:spcPts>`.
*
* Pass `null` to clear the override (the paragraph then inherits line
* spacing from the layout / master).
*/
const setParagraphLineSpacing = (shape, paragraphIndex, spacing) => {
	const pPr = ensurePPr(requireParagraph(shape, paragraphIndex));
	pPr.children = pPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "lnSpc"));
	if (spacing !== null) {
		if (!Number.isFinite(spacing.value) || spacing.value < 0) throw new RangeError(`line spacing value must be a non-negative number, got ${spacing.value}`);
		const inner = spacing.kind === "pct" ? elem(qname("a", "spcPct", NS.dml), { attrs: [attr(qname("", "val", ""), String(Math.round(spacing.value * 1e5)))] }) : elem(qname("a", "spcPts", NS.dml), { attrs: [attr(qname("", "val", ""), String(Math.round(spacing.value * 100)))] });
		insertChildByRank(pPr, elem(qname("a", "lnSpc", NS.dml), { children: [inner] }), pPrChildRank);
	}
	commitAndRefresh(shape);
};
/**
* Reads back the bullet style on a single paragraph, or `null` when
* no `<a:buChar>` / `<a:buAutoNum>` / `<a:buNone>` is present (the
* paragraph inherits its bullet from the layout / master).
*/
const getParagraphBullet = (shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (pPr === null) return null;
	for (const c of pPr.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "buNone") return "none";
		if (c.name.localName === "buChar") {
			const char = getAttrValue(c, qname("", "char", ""));
			if (char === "•") return "bullet";
			if (char !== null) return { char };
		}
		if (c.name.localName === "buAutoNum") {
			const t = getAttrValue(c, qname("", "type", ""));
			if (t === "arabicPeriod") return "number";
			if (t !== null) return { autoNum: t };
		}
	}
	return null;
};
/**
* Returns `true` when the paragraph uses an image as its bullet
* (`<a:pPr><a:buBlip r:embed="…"/>`). Renderers without image
* support should fall back to a generic bullet glyph.
*
* The underlying rId / image bytes aren't surfaced here — resolving
* that would need the rels of the layout / master the paragraph
* inherits from, which can be cumbersome. Knowing that the bullet
* *is* an image is usually enough for the UI to pick a fallback.
*/
const isParagraphBulletPicture = (shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (!pPr) return false;
	return firstChildElement(pPr, qname("a", "buBlip", NS.dml)) !== null;
};
/**
* Returns the embedded image bytes backing a paragraph's picture bullet
* (`<a:pPr><a:buBlip><a:blip r:embed="…"/>`), or `null` when the
* paragraph has no picture bullet or the relationship can't be resolved
* (external `r:link`, missing media part, etc.).
*
* The `r:embed` is resolved against the *slide's* relationships, matching
* `getShapeImageBytes` — a bullet whose blip lives only on an inherited
* layout/master paragraph isn't followed. The returned `Uint8Array` is a
* live view into the package media part; treat it as read-only.
*/
const getParagraphBulletImageBytes = (shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (!pPr) return null;
	const buBlip = firstChildElement(pPr, qname("a", "buBlip", NS.dml));
	if (!buBlip) return null;
	const blip = firstChildElement(buBlip, qname("a", "blip", NS.dml));
	if (!blip) return null;
	const rEmbed = getAttrValue(blip, qname("r", "embed", NS.officeDocRels));
	if (rEmbed === null) return null;
	const slide = shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (!rels) return null;
	const rel = rels.items.find((r) => r.id === rEmbed);
	if (!rel || rel.targetMode === "External") return null;
	const mediaName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
	return pkg.getPart(mediaName)?.data ?? null;
};
/**
* Reads the bullet's per-paragraph color, size, and font overrides —
* `<a:buClr>` (theme-resolved hex), `<a:buSzPct>` / `<a:buSzPts>`
* (size relative to run or fixed pt), and `<a:buFont typeface="…"/>`.
*
* Returns `{ color: null, sizePct: null, sizePts: null, font: null }`
* when the paragraph doesn't override any of them (the bullet inherits
* from the run / layout).
*/
const getParagraphBulletStyle = (pres, shape, paragraphIndex) => {
	const pPr = firstChildElement(requireParagraph(shape, paragraphIndex), NAME_A_PPR);
	if (!pPr) return {
		color: null,
		sizePct: null,
		sizePts: null,
		font: null
	};
	const theme = getPresentationTheme(pres);
	let color = null;
	let sizePct = null;
	let sizePts = null;
	let font = null;
	const buClr = firstChildElement(pPr, qname("a", "buClr", NS.dml));
	if (buClr) for (const c of buClr.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		color = resolveDrawingColor(c, theme);
		break;
	}
	const buSzPct = firstChildElement(pPr, qname("a", "buSzPct", NS.dml));
	if (buSzPct) {
		const v = getAttrValue(buSzPct, qname("", "val", ""));
		if (v !== null) {
			let n = Number.parseFloat(v);
			if (Number.isFinite(n)) {
				if (Math.abs(n) > 1) n = n / 1e5;
				sizePct = n;
			}
		}
	}
	const buSzPts = firstChildElement(pPr, qname("a", "buSzPts", NS.dml));
	if (buSzPts) {
		const v = getAttrValue(buSzPts, qname("", "val", ""));
		if (v !== null) {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n)) sizePts = n / 100;
		}
	}
	const buFont = firstChildElement(pPr, qname("a", "buFont", NS.dml));
	if (buFont) {
		const t = getAttrValue(buFont, qname("", "typeface", ""));
		if (t !== null) font = t;
	}
	return {
		color,
		sizePct,
		sizePts,
		font
	};
};
/**
* Sets the bullet style on a single paragraph. Same `BulletStyle` shape
* as `setShapeBulletStyle` — pass `'bullet'` / `'number'` / `'none'` or an
* object like `{ char: '◆' }` / `{ autoNum: 'romanLcPeriod' }`.
*/
const setParagraphBullet = (shape, paragraphIndex, style) => {
	applyBulletToParagraph(requireParagraph(shape, paragraphIndex), style);
	commitAndRefresh(shape);
};
/**
* Sets the text of a single run. Existing rPr (font, size, color, ...)
* is preserved — only the visible characters change.
*/
const setShapeRunText = (shape, paragraphIndex, runIndex, text) => {
	writeRunText(requireRun(shape, paragraphIndex, runIndex), text);
	commitAndRefresh(shape);
};
//#endregion
//#region src/api/fn/shape-color.ts
const COLOR_TRANSFORM_LOCALS = new Set([
	"lumMod",
	"lumOff",
	"shade",
	"tint",
	"satMod",
	"satOff",
	"hueMod",
	"hueOff",
	"alpha",
	"alphaMod",
	"alphaOff",
	"gray",
	"inv",
	"comp"
]);
const parseColorTransforms = (colorEl) => {
	const out = [];
	for (const child of colorEl.children) {
		if (child.kind !== "element" || child.name.namespaceURI !== NS.dml) continue;
		const local = child.name.localName;
		if (!COLOR_TRANSFORM_LOCALS.has(local)) continue;
		if (local === "gray" || local === "inv" || local === "comp") {
			out.push({ kind: local });
			continue;
		}
		const raw = getAttrValue(child, qname("", "val", ""));
		if (raw === null) continue;
		let n = Number.parseFloat(raw);
		if (!Number.isFinite(n)) continue;
		if (Math.abs(n) > 1) n = n / 1e5;
		out.push({
			kind: local,
			val: n
		});
	}
	return out;
};
const hexToRgb01 = (hex) => {
	const h = hex.startsWith("#") ? hex.slice(1) : hex;
	return [
		Number.parseInt(h.slice(0, 2), 16) / 255,
		Number.parseInt(h.slice(2, 4), 16) / 255,
		Number.parseInt(h.slice(4, 6), 16) / 255
	];
};
const rgb01ToHex = (r, g, b) => {
	const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
	const part = (n) => n.toString(16).padStart(2, "0").toUpperCase();
	return `#${part(clamp(r))}${part(clamp(g))}${part(clamp(b))}`;
};
const rgbToHsl = (r, g, b) => {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [
		0,
		0,
		l
	];
	const d = max - min;
	const s = l > .5 ? d / (2 - max - min) : d / (max + min);
	let h;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return [
		h / 6,
		s,
		l
	];
};
const hueToRgb = (p, q, t) => {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
	return p;
};
const hslToRgb = (h, s, l) => {
	if (s === 0) return [
		l,
		l,
		l
	];
	const q = l < .5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [
		hueToRgb(p, q, h + 1 / 3),
		hueToRgb(p, q, h),
		hueToRgb(p, q, h - 1 / 3)
	];
};
const srgbToLinear = (c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const linearToSrgb = (c) => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
const applyColorTransforms = (hex, transforms) => {
	if (transforms.length === 0) return hex;
	let [r, g, b] = hexToRgb01(hex);
	for (const t of transforms) switch (t.kind) {
		case "inv":
			r = 1 - r;
			g = 1 - g;
			b = 1 - b;
			break;
		case "gray":
			r = g = b = .3 * r + .59 * g + .11 * b;
			break;
		case "comp": {
			const [h, s, l] = rgbToHsl(r, g, b);
			[r, g, b] = hslToRgb((h + .5) % 1, s, l);
			break;
		}
		case "shade":
			r = linearToSrgb(srgbToLinear(r) * t.val);
			g = linearToSrgb(srgbToLinear(g) * t.val);
			b = linearToSrgb(srgbToLinear(b) * t.val);
			break;
		case "tint":
			r = linearToSrgb(srgbToLinear(r) * t.val + (1 - t.val));
			g = linearToSrgb(srgbToLinear(g) * t.val + (1 - t.val));
			b = linearToSrgb(srgbToLinear(b) * t.val + (1 - t.val));
			break;
		case "lumMod":
		case "lumOff": {
			const [h, s, l] = rgbToHsl(r, g, b);
			const newL = Math.max(0, Math.min(1, t.kind === "lumMod" ? l * t.val : l + t.val));
			[r, g, b] = hslToRgb(h, s, newL);
			break;
		}
		case "satMod":
		case "satOff": {
			const [h, s, l] = rgbToHsl(r, g, b);
			const newS = Math.max(0, Math.min(1, t.kind === "satMod" ? s * t.val : s + t.val));
			[r, g, b] = hslToRgb(h, newS, l);
			break;
		}
		case "hueMod":
		case "hueOff": {
			const [h, s, l] = rgbToHsl(r, g, b);
			const newH = ((t.kind === "hueMod" ? h * t.val : h + t.val / 360) % 1 + 1) % 1;
			[r, g, b] = hslToRgb(newH, s, l);
			break;
		}
	}
	return rgb01ToHex(r, g, b);
};
const SCHEME_TOKEN_TO_THEME_KEY = {
	tx1: "dark1",
	dk1: "dark1",
	bg1: "light1",
	lt1: "light1",
	tx2: "dark2",
	dk2: "dark2",
	bg2: "light2",
	lt2: "light2",
	accent1: "accent1",
	accent2: "accent2",
	accent3: "accent3",
	accent4: "accent4",
	accent5: "accent5",
	accent6: "accent6",
	hlink: "hyperlink",
	folHlink: "followedHyperlink"
};
/**
* Resolves a scheme token (`tx1`, `bg1`, `accent1`, …) to its `#RRGGBB`.
*
* When `clrMap` is supplied, the slide token is first remapped through it
* (`<p:clrMap>` / `<a:overrideClrMapping>`) — `tx1` may point at `dk1` or
* `lt1` depending on the deck — and only then indexed into the theme. Without
* a map the token is indexed directly, preserving the historical behavior
* (correct for the standard map, the overwhelming common case).
*
* @internal
*/
const resolveSchemeToken = (token, theme, clrMap) => {
	if (!theme) return null;
	const key = SCHEME_TOKEN_TO_THEME_KEY[clrMap?.[token] ?? token] ?? SCHEME_TOKEN_TO_THEME_KEY[token];
	if (!key) return null;
	const hex = theme[key];
	if (typeof hex !== "string") return null;
	const normalized = hex.startsWith("#") ? hex : `#${hex}`;
	return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toUpperCase() : null;
};
/**
* Resolves a DrawingML color element (`<a:srgbClr>` / `<a:schemeClr>` /
* `<a:sysClr>` / `<a:prstClr>`) with all its `<a:lumMod>` / `<a:tint>` /
* `<a:shade>` / `<a:satMod>` etc. transform children applied. Returns
* `null` when the color is a scheme token and no theme is supplied to
* resolve it.
*
* Exposed because both run-format and fill-format code paths need to
* apply the same transform pipeline; keeping a single implementation
* means future spec-coverage additions only have to land in one place.
*/
const resolveDrawingColor = (colorEl, theme, clrMap) => {
	if (colorEl.name.namespaceURI !== NS.dml) return null;
	const local = colorEl.name.localName;
	let baseHex = null;
	if (local === "srgbClr") {
		const v = getAttrValue(colorEl, qname("", "val", ""));
		if (v) baseHex = `#${v.toUpperCase()}`;
	} else if (local === "schemeClr") {
		const v = getAttrValue(colorEl, qname("", "val", ""));
		if (v) baseHex = resolveSchemeToken(v, theme, clrMap);
	} else if (local === "sysClr") {
		const last = getAttrValue(colorEl, qname("", "lastClr", ""));
		if (last) baseHex = `#${last.toUpperCase()}`;
	} else if (local === "prstClr") {
		const v = getAttrValue(colorEl, qname("", "val", ""));
		if (v === "black") baseHex = "#000000";
		else if (v === "white") baseHex = "#FFFFFF";
	}
	if (!baseHex) return null;
	return applyColorTransforms(baseHex, parseColorTransforms(colorEl));
};
/**
* Resolves the opacity a DrawingML color element carries through its
* `<a:alpha>` / `<a:alphaMod>` / `<a:alphaOff>` children (ECMA-376
* §20.1.2.3.1–3) to a `0`–`1` fraction, applied in document order from a
* fully opaque base. Returns `null` when the element has no alpha
* transform — PowerPoint paints that opaque, but callers can still tell
* "unspecified" apart from an explicit `1`.
*
* Kept separate from `resolveDrawingColor` because alpha never changes the
* `#RRGGBB`; OOXML encodes the two independently and renderers emit the
* opacity next to the color (`fill-opacity` / `stroke-opacity`).
*/
const resolveDrawingColorOpacity = (colorEl) => {
	if (colorEl.name.namespaceURI !== NS.dml) return null;
	let opacity = null;
	for (const t of parseColorTransforms(colorEl)) if (t.kind === "alpha") opacity = t.val;
	else if (t.kind === "alphaMod") opacity = (opacity ?? 1) * t.val;
	else if (t.kind === "alphaOff") opacity = (opacity ?? 1) + t.val;
	return opacity === null ? null : Math.max(0, Math.min(1, opacity));
};
const parseRPrLikeElement = (rPr, ctx) => {
	const out = {};
	const sz = getAttrValue(rPr, qname("", "sz", ""));
	if (sz !== null) {
		const n = Number.parseInt(sz, 10);
		if (Number.isFinite(n)) out.size = n / 100;
	}
	const b = getAttrValue(rPr, qname("", "b", ""));
	if (b !== null) out.bold = b !== "0";
	const i = getAttrValue(rPr, qname("", "i", ""));
	if (i !== null) out.italic = i !== "0";
	const u = getAttrValue(rPr, qname("", "u", ""));
	if (u !== null) if (u === "none") out.underline = false;
	else if (u === "sng") out.underline = true;
	else out.underline = u;
	const strike = getAttrValue(rPr, qname("", "strike", ""));
	if (strike !== null) if (strike === "noStrike") out.strike = false;
	else if (strike === "sngStrike") out.strike = true;
	else out.strike = strike;
	const spc = getAttrValue(rPr, qname("", "spc", ""));
	if (spc !== null) {
		const n = Number.parseInt(spc, 10);
		if (Number.isFinite(n)) out.spc = n;
	}
	const kern = getAttrValue(rPr, qname("", "kern", ""));
	if (kern !== null) {
		const n = Number.parseInt(kern, 10);
		if (Number.isFinite(n)) out.kern = n;
	}
	const baselineAttr = getAttrValue(rPr, qname("", "baseline", ""));
	if (baselineAttr !== null) {
		let n = Number.parseFloat(baselineAttr);
		if (Number.isFinite(n)) {
			if (Math.abs(n) > 1) n = n / 1e5;
			out.baseline = n;
		}
	}
	const cap = getAttrValue(rPr, qname("", "cap", ""));
	if (cap === "none" || cap === "small" || cap === "all") out.cap = cap;
	const highlight = firstChildElement(rPr, qname("a", "highlight", NS.dml));
	if (highlight !== null) {
		let hlChild = null;
		for (const c of highlight.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			hlChild = c;
			break;
		}
		if (hlChild) {
			if (ctx) {
				const hex = resolveDrawingColor(hlChild, ctx.theme);
				if (hex !== null) out.highlight = hex;
			} else if (hlChild.name.localName === "srgbClr") {
				const v = getAttrValue(hlChild, qname("", "val", ""));
				if (v !== null) out.highlight = `#${v.toUpperCase()}`;
			} else if (hlChild.name.localName === "schemeClr") {
				const v = getAttrValue(hlChild, qname("", "val", ""));
				if (v !== null) out.highlight = v;
			}
		}
	}
	const solidFill = firstChildElement(rPr, qname("a", "solidFill", NS.dml));
	if (solidFill !== null) {
		let colorChild = null;
		for (const c of solidFill.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			colorChild = c;
			break;
		}
		if (colorChild) {
			if (ctx) {
				const hex = resolveDrawingColor(colorChild, ctx.theme);
				if (hex !== null) out.color = hex;
				else if (colorChild.name.localName === "schemeClr") {
					const v = getAttrValue(colorChild, qname("", "val", ""));
					if (v !== null) out.color = v;
				}
			} else if (colorChild.name.localName === "srgbClr") {
				const v = getAttrValue(colorChild, qname("", "val", ""));
				if (v !== null) out.color = `#${v.toUpperCase()}`;
			} else if (colorChild.name.localName === "schemeClr") {
				const v = getAttrValue(colorChild, qname("", "val", ""));
				if (v !== null) out.color = v;
			}
		}
	}
	const latin = firstChildElement(rPr, qname("a", "latin", NS.dml));
	if (latin !== null) {
		const t = getAttrValue(latin, qname("", "typeface", ""));
		if (t !== null) out.font = t;
	}
	const ea = firstChildElement(rPr, qname("a", "ea", NS.dml));
	if (ea !== null) {
		const t = getAttrValue(ea, qname("", "typeface", ""));
		if (t !== null) out.fontEastAsian = t;
	}
	const cs = firstChildElement(rPr, qname("a", "cs", NS.dml));
	if (cs !== null) {
		const t = getAttrValue(cs, qname("", "typeface", ""));
		if (t !== null) out.fontComplexScript = t;
	}
	return out;
};
/**
* Reads back the format of a single run. Returns `null` when the run
* has no `<a:rPr>` (it inherits its format from the paragraph /
* layout / master). Boolean attributes that are explicitly `"0"`
* decode to `false`.
*
* Use `getShapeRunFormatEffective` if you want the resolved format
* after walking the placeholder / lstStyle / master inheritance chain.
*/
const getShapeRunFormat = (shape, paragraphIndex, runIndex) => {
	const rPr = firstChildElement(requireRun(shape, paragraphIndex, runIndex), NAME_A_RPR);
	if (rPr === null) return null;
	return parseRPrLikeElement(rPr);
};
//#endregion
//#region src/api/fn/shape-fill-stroke.ts
/** Sets the shape's position in EMU. Companion to `setShapeSize`. */
const setShapePosition = (shape, x, y) => {
	setPosition(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind, x, y);
	commitAndRefresh(shape);
};
/** Sets the shape's size in EMU. */
const setShapeSize = (shape, w, h) => {
	setSize(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind, w, h);
	commitAndRefresh(shape);
};
/**
* Sets the shape's rotation in degrees (positive clockwise). Values are
* normalized into `[0, 360)`; pass `0` to clear an existing rotation.
*/
const setShapeRotation = (shape, degrees) => {
	setRotation(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind, degrees);
	commitAndRefresh(shape);
};
/**
* Sets the shape's preset-geometry adjust values (`<a:prstGeom><a:avLst>`),
* replacing any guides already authored. Keys are ECMA-376 guide names and
* values are the raw guide numbers (rounded to integers). The companion
* reader is {@link getShapeAdjustValues}.
*
* The common use is the corner radius of the `roundRect` preset, whose `adj`
* guide runs `0..50000` (thousandths of a percent of the shorter side;
* `16667` ≈ the PowerPoint default, `0` = square corners, `50000` = fully
* rounded). For example, `setShapeAdjustValues(shape, { adj: 5000 })` gives a
* subtle 5% rounding.
*
* Throws when the shape has no preset geometry (`<a:prstGeom>`) — a custom or
* inherited geometry has no adjust list to author.
*/
const setShapeAdjustValues = (shape, values) => {
	if (!setAdjustValues(shape[SHAPE_ELEMENT], values)) throw new Error("setShapeAdjustValues: shape has no preset geometry (<a:prstGeom>)");
	commitAndRefresh(shape);
};
/** Sets the shape's flip flags. Properties default to current state when omitted. */
const setShapeFlip = (shape, options) => {
	setFlip(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind, options);
	commitAndRefresh(shape);
};
/** Sets a solid fill on the shape (color in `#RRGGBB` or scheme token). */
const setShapeFill = (shape, color) => {
	setSolidFill(requireSpPr(shape), color);
	commitAndRefresh(shape);
};
/**
* Sets a linear gradient fill on the shape. Stops must lie in `[0, 1]`;
* `angleDeg` defaults to `90` (top → bottom).
*
* Example: red → blue top-to-bottom:
*
*   setShapeGradientFill(shape, {
*     stops: [{ offset: 0, color: '#FF0000' }, { offset: 1, color: '#0000FF' }],
*     angleDeg: 90,
*   });
*/
const setShapeGradientFill = (shape, options) => {
	setGradientFill(requireSpPr(shape), options);
	commitAndRefresh(shape);
};
/**
* Sets a preset pattern fill on the shape (e.g. `pct50`, `dkUpDiag`).
*
* `foreground` is the pattern stroke color; `background` fills behind
* the pattern. Both accept `#RRGGBB`, bare `RRGGBB`, or scheme tokens
* (`accent1`, `bg1`, ...).
*/
const setShapePatternFill = (shape, options) => {
	setPatternFill(requireSpPr(shape), options);
	commitAndRefresh(shape);
};
/**
* Reads back the pattern fill on a shape: returns the preset token
* plus the foreground / background colors resolved against the theme.
* Returns `null` when the shape has no `<a:pattFill>`.
*
* The preset string is the literal `ST_PresetPatternVal` token from
* §20.1.10.49 — e.g. `'pct50'`, `'dkUpDiag'`, `'cross'`, `'wave'`.
* Renderers can map it onto an SVG `<pattern>` definition.
*/
const getShapePatternFill = (pres, shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const pattFill = firstChildElement(spPr, qname("a", "pattFill", NS.dml));
	if (!pattFill) return null;
	const preset = getAttrValue(pattFill, qname("", "prst", "")) ?? "pct50";
	const theme = getPresentationTheme(pres);
	const colorFrom = (parentName, fallback) => {
		const parent = firstChildElement(pattFill, qname("a", parentName, NS.dml));
		if (!parent) return fallback;
		for (const c of parent.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			const hex = resolveDrawingColor(c, theme);
			if (hex) return hex;
		}
		return fallback;
	};
	return {
		preset,
		foreground: colorFrom("fgClr", "#000000"),
		background: colorFrom("bgClr", "#FFFFFF")
	};
};
/**
* Sets a picture fill on the shape, embedding `bytes` as a new media
* part and replacing any prior fill choice on the shape's `<p:spPr>`.
*
* The image stretches to fill the shape (`<a:stretch><a:fillRect/>`).
* Format is detected from magic bytes; pass `options.format` to
* override (useful for SVG or unusual extensions).
*
* Throws if the format can't be detected and isn't provided explicitly,
* or if the shape kind doesn't carry a `<p:spPr>` (e.g. groups).
*/
const setShapeImageFill = (shape, bytes, options = {}) => {
	const format = options.format ?? detectImageFormat(bytes);
	if (format === null) throw new Error("setShapeImageFill: could not detect image format. Pass options.format explicitly.");
	const contentType = contentTypeForFormat(format);
	const extension = extensionForFormat(format);
	const slide = shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	let nextN = 1;
	const mediaPattern = /^\/ppt\/media\/image(\d+)\./;
	for (const p of pkg.parts) {
		const m = p.name.match(mediaPattern);
		if (m?.[1] !== void 0) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n) && n >= nextN) nextN = n + 1;
		}
	}
	const newMediaName = partName(`/ppt/media/image${nextN}.${extension}`);
	setOpcDefault(pkg, extension, contentType);
	pkg.addPart(newMediaName, contentType, bytes);
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
	const newRId = nextRelId(rels.items.map((r) => r.id));
	rels.items.push({
		id: newRId,
		type: REL_TYPES.image,
		target: `../media/image${nextN}.${extension}`,
		targetMode: "Internal"
	});
	pkg.setRels(slide[SLIDE_PART_NAME], rels);
	const spPr = requireSpPr(shape);
	const FILL_CHOICES = new Set([
		"noFill",
		"solidFill",
		"gradFill",
		"blipFill",
		"pattFill",
		"grpFill"
	]);
	spPr.children = spPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && FILL_CHOICES.has(c.name.localName)));
	const blipName = qname("a", "blip", NS.dml);
	const stretchName = qname("a", "stretch", NS.dml);
	const fillRectName = qname("a", "fillRect", NS.dml);
	const blipFill = elem(qname("a", "blipFill", NS.dml), { children: [elem(blipName, { attrs: [attr(qname("r", "embed", NS.officeDocRels), newRId)] }), elem(stretchName, { children: [elem(fillRectName)] })] });
	let insertAt = spPr.children.length;
	for (let i = 0; i < spPr.children.length; i++) {
		const c = spPr.children[i];
		if (c?.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "ln" || c.name.localName === "effectLst" || c.name.localName === "effectDag" || c.name.localName === "scene3d" || c.name.localName === "sp3d" || c.name.localName === "extLst") {
			insertAt = i;
			break;
		}
	}
	spPr.children.splice(insertAt, 0, blipFill);
	commitAndRefresh(shape);
};
/** Sets `<a:noFill>` on the shape, leaving it transparent. */
const setShapeNoFill = (shape) => {
	setNoFill(requireSpPr(shape));
	commitAndRefresh(shape);
};
/**
* Removes any fill choice from the shape; it then inherits its fill
* from the layout / master placeholder it descends from.
*/
const clearShapeFill = (shape) => {
	clearFill(requireSpPr(shape));
	commitAndRefresh(shape);
};
/** Sets a solid-color outline on the shape. */
const setShapeStroke = (shape, options) => {
	setSolidStroke(requireSpPr(shape), options);
	commitAndRefresh(shape);
};
/** Sets an explicit "no outline" on the shape. */
const setShapeNoStroke = (shape) => {
	setNoStroke(requireSpPr(shape));
	commitAndRefresh(shape);
};
/** Reads back the shape's stroke dash style, or `null` if none. */
const getShapeStrokeDash = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
	if (!ln) return null;
	const prstDash = firstChildElement(ln, qname("a", "prstDash", NS.dml));
	if (!prstDash) return null;
	return getAttrValue(prstDash, qname("", "val", "")) ?? null;
};
/**
* Reads back the shape's arrowhead on one end of `<a:ln>`, or `null`
* when no `<a:headEnd>` / `<a:tailEnd>` is present.
*/
const getShapeStrokeArrow = (shape, end) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
	if (!ln) return null;
	const arr = firstChildElement(ln, qname("a", end === "head" ? "headEnd" : "tailEnd", NS.dml));
	if (!arr) return null;
	const type = getAttrValue(arr, qname("", "type", ""));
	if (!type) return null;
	const width = getAttrValue(arr, qname("", "w", ""));
	const length = getAttrValue(arr, qname("", "len", ""));
	const result = { type };
	if (width === "sm" || width === "med" || width === "lg") result.width = width;
	if (length === "sm" || length === "med" || length === "lg") result.length = length;
	return result;
};
/**
* Sets the dash pattern for the shape's outline (`<a:prstDash>`). One
* of ECMA-376's `ST_PresetLineDashVal` tokens:
*
*   `'solid'` | `'dot'` | `'dash'` | `'lgDash'` | `'dashDot'` |
*   `'lgDashDot'` | `'lgDashDotDot'` | `'sysDash'` | `'sysDot'` |
*   `'sysDashDot'` | `'sysDashDotDot'`
*
* Creates `<a:ln>` if absent. Pairs naturally with `setShapeStroke`:
* users typically set a color + width first, then the dash.
*/
const setShapeStrokeDash = (shape, dash) => {
	setStrokeDash(requireSpPr(shape), dash);
	commitAndRefresh(shape);
};
/**
* Sets an arrowhead on one end of the shape's outline.
*
*   - `end: 'head'` writes `<a:headEnd>` (the start of the line).
*   - `end: 'tail'` writes `<a:tailEnd>` (the end).
*
* Useful primarily on connector shapes added via `addSlideLine`.
* `type: 'none'` clears the arrowhead.
*/
const setShapeStrokeArrow = (shape, end, options) => {
	setStrokeArrow(requireSpPr(shape), end, options);
	commitAndRefresh(shape);
};
/** Removes any outline override; the shape then inherits stroke from layout. */
const clearShapeStroke = (shape) => {
	clearStroke(requireSpPr(shape));
	commitAndRefresh(shape);
};
/**
* Sets the line-cap style on the shape's outline (`<a:ln cap="…">`).
*
*   - `'rnd'`  — rounded ends.
*   - `'sq'`   — square ends extending past the endpoint.
*   - `'flat'` — square ends flush at the endpoint (the OOXML default).
*
* Pass `null` to clear the attribute so the cap inherits the default.
* Creates `<a:ln>` if absent.
*/
const setShapeStrokeCap = (shape, cap) => {
	setStrokeCap(requireSpPr(shape), cap);
	commitAndRefresh(shape);
};
/**
* Sets the line-join style on the shape's outline. Picks one of the
* three child-element variants of `<a:ln>`:
*
*   - `'round'` → `<a:round/>`
*   - `'bevel'` → `<a:bevel/>`
*   - `'miter'` → `<a:miter/>`
*
* Pass `null` to clear any prior join child so the shape inherits the
* default. Creates `<a:ln>` if absent.
*/
const setShapeStrokeJoin = (shape, join) => {
	setStrokeJoin(requireSpPr(shape), join);
	commitAndRefresh(shape);
};
/**
* Sets the compound-line style on the shape's outline
* (`<a:ln cmpd="…">`) — single, double, triple, or thick/thin variants.
* ECMA-376 §20.1.10.31 `ST_CompoundLine`. Pass `null` to clear the
* attribute. Creates `<a:ln>` if absent.
*/
const setShapeStrokeCompound = (shape, cmpd) => {
	setStrokeCompound(requireSpPr(shape), cmpd);
	commitAndRefresh(shape);
};
//#endregion
//#region src/api/fn/shape-read-base.ts
const getShapeKind = (shape) => shape[SHAPE_SNAPSHOT].kind;
const getShapeId = (shape) => shape[SHAPE_SNAPSHOT].id;
/**
* Returns the preset-geometry token (`'rect'`, `'ellipse'`, `'star5'`,
* `'rightArrow'`, ...) for shapes whose body carries a
* `<a:prstGeom prst="…"/>`. Returns `null` for:
*
*   - non-`'shape'` kinds (pictures, connectors, group shapes, tables,
*     charts — they have their own geometry tags or no geometry),
*   - shapes using custom geometry (`<a:custGeom>`),
*   - shapes whose preset is missing (malformed but possible).
*
* Useful for renderers / inspectors that want to draw a faithful
* approximation of each shape without dropping to the raw XML.
*/
const getShapePreset = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "shape" && shape[SHAPE_SNAPSHOT].kind !== "connector") return null;
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const prstGeom = firstChildElement(spPr, qname("a", "prstGeom", NS.dml));
	if (!prstGeom) return null;
	for (const a of prstGeom.attrs) if (a.name.localName === "prst") return a.value;
	return null;
};
/**
* Reads the preset's adjust-handle values (`<a:prstGeom><a:avLst>
* <a:gd name="adj" fmla="val 30000"/></a:avLst>`) as a map from guide
* name → numeric value. Per ECMA-376 §20.1.9.4, guides are stored
* with a formula prefix — `val 12345` is a literal number, and the
* other prefixes (`pin`, `+-`, etc.) compute from other guides. We
* only surface the `val` form because other formulas reference the
* preset's built-in guides and don't make sense without them.
*
* Returns an empty record when no adjust values are authored (the
* shape paints at its preset defaults).
*/
const getShapeAdjustValues = (shape) => {
	const out = {};
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return out;
	const prstGeom = firstChildElement(spPr, qname("a", "prstGeom", NS.dml));
	if (!prstGeom) return out;
	const avLst = firstChildElement(prstGeom, qname("a", "avLst", NS.dml));
	if (!avLst) return out;
	for (const gd of avLst.children) {
		if (gd.kind !== "element" || gd.name.namespaceURI !== NS.dml || gd.name.localName !== "gd") continue;
		const name = getAttrValue(gd, qname("", "name", ""));
		const fmla = getAttrValue(gd, qname("", "fmla", ""));
		if (!name || !fmla) continue;
		const match = /^val\s+(-?\d+(?:\.\d+)?)$/.exec(fmla);
		if (!match) continue;
		const n = Number.parseFloat(match[1]);
		if (Number.isFinite(n)) out[name] = n;
	}
	return out;
};
/**
* Reads a shape's custom geometry (`<a:custGeom>`, ECMA-376 §20.1.9) as a
* fully-evaluated path list. Returns `null` when the shape has no
* `<a:custGeom>` in its own `<p:spPr>` (it uses a preset, inherits
* geometry, or isn't a drawable shape), and also `null` when the geometry
* is present but malformed — an unresolved guide reference, an unknown
* `fmla` operator, or a command missing its points — so callers can fall
* back rather than emit broken output.
*
* Guide formulas in `<a:avLst>` / `<a:gdLst>` are evaluated in document
* order against the implicit built-in guides (`w`, `h`, `ss`, `hc`, the
* `cdN` angle constants, …) derived from the shape extents. Per spec,
* division by zero yields `0`. The returned commands carry only numbers —
* no guide names survive.
*
* Pairs with `getShapePreset` (which returns `null` for custom-geometry
* shapes): a renderer calls `getShapePreset` first, and falls through to
* this when it gets `null`.
*/
const getShapeCustomGeometry = (shape) => {
	const kind = shape[SHAPE_SNAPSHOT].kind;
	if (kind !== "shape" && kind !== "connector") return null;
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const custGeom = firstChildElement(spPr, qname("a", "custGeom", NS.dml));
	if (!custGeom) return null;
	const size = readSize(shape[SHAPE_ELEMENT], kind);
	if (size === null) return null;
	return parseCustomGeometry(custGeom, size.w, size.h);
};
/**
* Returns the highest `cNvPr@id` used by any shape on the slide,
* or `0` when the slide has no shapes with non-negative ids.
*
* Useful when hand-rolling a custom shape and you need an id known
* not to collide. The official allocator inside `addSlideShape` /
* `addSlideTextBox` etc. already does this — call those instead
* when you don't need a custom id.
*/
const getMaxShapeId = (slide) => {
	let max = 0;
	for (const shape of slide[SLIDE_SHAPES]) {
		const id = shape[SHAPE_SNAPSHOT].id;
		if (id > max) max = id;
	}
	return max;
};
/**
* Deck-wide sibling of `getMaxShapeId`. Returns the highest
* `cNvPr@id` across every shape on every slide, or `0` when the
* deck has no shapes.
*
* Note: shape ids are scoped to a slide in OOXML — collisions
* across slides are fine. This helper is for the rare cases where
* a caller wants a single id known to be higher than anything in
* the deck (e.g. to keep ids monotonically increasing).
*/
const getMaxShapeIdInPresentation = (pres) => {
	let max = 0;
	for (const slide of getSlides(pres)) for (const shape of slide[SLIDE_SHAPES]) {
		const id = shape[SHAPE_SNAPSHOT].id;
		if (id > max) max = id;
	}
	return max;
};
/**
* Returns the number of slide masters declared in the
* presentation's `<p:sldMasterIdLst>`. Most decks use exactly one
* master; multi-master decks come from templates that combine
* brand variants (e.g. a corporate master + a sponsor master).
*
* Returns `0` if `presentation.xml` is missing.
*/
const getSlideMasterCount = (pres) => {
	const presPart = pres[INTERNAL_PACKAGE].getPart(PRES_PART_NAME);
	if (presPart === null) return 0;
	const root = parseXml(decode$1(presPart.data)).root;
	return readPresentationPart(root).slideMasters.length;
};
/**
* Returns the package part name of every slide master declared in
* `presentation.xml`, resolved through the presentation's `.rels`.
* Sibling of `getSlideMasterCount` for downstream tooling that
* needs the master URIs (e.g. byte-level diff, custom validators).
*
* Returns an empty array when `presentation.xml` or its `.rels`
* are missing.
*/
/**
* Returns the part name of the slide master a slide inherits from
* (`/ppt/slideMasters/slideMaster1.xml`), or `null` when the slide
* has no layout or its layout has no master rel.
*
* Useful for multi-master decks where different slides live under
* different brand templates and the caller needs to scope theme /
* fontScheme / clrMap lookups to the correct master.
*/
const getSlideMasterPartName = (slide) => {
	const layout = getSlideLayout(slide);
	if (!layout) return null;
	const pkg = slide[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return null;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return null;
	return resolveTarget(layoutPartName, masterRel.target);
};
const getSlideMasterPartNames = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (presPart === null) return [];
	const root = parseXml(decode$1(presPart.data)).root;
	const model = readPresentationPart(root);
	const rels = pkg.getRels(PRES_PART_NAME);
	if (rels === null) return [];
	const out = [];
	for (const m of model.slideMasters) {
		const rel = rels.items.find((r) => r.id === m.rId);
		if (rel === void 0) continue;
		const resolved = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(PRES_PART_NAME, rel.target);
		out.push(resolved);
	}
	return out;
};
/**
* Histogram of master part name → number of slides whose layout chains
* up to that master. Every master in the package appears as a key
* (count `0` for unreferenced masters), so the function surfaces
* unused masters directly — useful for trimming multi-master template
* decks. Pair with `getSlideLayoutUsageCounts` for the layout layer.
*/
const getSlideMasterUsageCounts = (pres) => {
	const counts = {};
	for (const masterName of getSlideMasterPartNames(pres)) counts[masterName] = 0;
	for (const slide of getSlides(pres)) {
		const name = getSlideMasterPartName(slide);
		if (name === null) continue;
		counts[name] = (counts[name] ?? 0) + 1;
	}
	return counts;
};
/**
* Master part names that no slide chains to (count of `0` in
* `getSlideMasterUsageCounts`). Pair to `getUnusedSlideLayouts`.
* Useful when trimming multi-master template decks of dead theme
* variants.
*/
const getUnusedSlideMasters = (pres) => {
	const counts = getSlideMasterUsageCounts(pres);
	return getSlideMasterPartNames(pres).filter((m) => (counts[m] ?? 0) === 0);
};
const getShapeName = (shape) => shape[SHAPE_SNAPSHOT].name;
/**
* Renames the shape's `cNvPr@name`. The display name is what
* PowerPoint shows in the Selection Pane and what `findShapeByName`
* matches on. Empty strings are allowed (matches PowerPoint behavior).
*/
/**
* Reads the shape's alt-text description (`<p:cNvPr descr="...">`).
* Accessibility tools (screen readers, contrast checkers) and
* PowerPoint's "Alt Text" pane look at this field. Returns `null`
* when no description is set.
*/
const getShapeDescription = (shape) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) return null;
	return getAttrValue(cNvPr, qname("", "descr", ""));
};
/**
* Sets the shape's alt-text description (`<p:cNvPr descr="...">`).
* Pass `null` to clear. Important for accessibility — image shapes
* and decorative graphics should carry a descr that conveys the
* visual meaning to screen readers.
*/
const setShapeDescription = (shape, description) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) throw new Error(`setShapeDescription: ${shape[SHAPE_SNAPSHOT].kind} shape has no cNvPr`);
	cNvPr.attrs = cNvPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "descr"));
	if (description !== null && description !== "") cNvPr.attrs.push(attr(qname("", "descr", ""), description));
	commitAndRefresh(shape);
};
/**
* Reads the shape's alt-text title (`<p:cNvPr title="...">`).
* PowerPoint surfaces this alongside `descr` in its Alt Text pane
* as a short heading. Returns `null` when no title is set.
*/
const getShapeAltTitle = (shape) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) return null;
	return getAttrValue(cNvPr, qname("", "title", ""));
};
/**
* Sets the shape's alt-text title (`<p:cNvPr title="...">`). Pass
* `null` to clear. Distinct from `renameShape`, which writes the
* `name` attribute used in the selection pane.
*/
const setShapeAltTitle = (shape, title) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) throw new Error(`setShapeAltTitle: ${shape[SHAPE_SNAPSHOT].kind} shape has no cNvPr`);
	cNvPr.attrs = cNvPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "title"));
	if (title !== null && title !== "") cNvPr.attrs.push(attr(qname("", "title", ""), title));
	commitAndRefresh(shape);
};
/**
* `true` when the shape's `<p:cNvPr hidden="1">` is set. Hidden
* shapes are skipped by PowerPoint's renderer but stay in the
* shape tree — useful for variant slides that toggle which boxes
* are visible.
*/
const isShapeHidden = (shape) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) return false;
	const v = getAttrValue(cNvPr, qname("", "hidden", ""));
	return v === "1" || v === "true";
};
/**
* Sets or clears `<p:cNvPr hidden="...">` on the shape. Hidden
* shapes remain in the document but PowerPoint doesn't render them.
*/
const setShapeHidden = (shape, hidden) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) throw new Error(`setShapeHidden: ${shape[SHAPE_SNAPSHOT].kind} shape has no cNvPr`);
	cNvPr.attrs = cNvPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "hidden"));
	if (hidden) cNvPr.attrs.push(attr(qname("", "hidden", ""), "1"));
	commitAndRefresh(shape);
};
const renameShape = (shape, newName) => {
	const cNvPr = findCNvPr(shape);
	if (!cNvPr) throw new Error(`renameShape: ${shape[SHAPE_SNAPSHOT].kind} shape has no cNvPr to rename`);
	cNvPr.attrs = cNvPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "name"));
	cNvPr.attrs.push(attr(qname("", "name", ""), newName));
	commitAndRefresh(shape);
};
const getShapePlaceholderType = (shape) => shape[SHAPE_SNAPSHOT].placeholderType;
const getShapePlaceholderIdx = (shape) => shape[SHAPE_SNAPSHOT].placeholderIdx;
/**
* `true` when the shape carries `<p:nvSpPr><p:nvPr><p:ph>` — i.e. it
* inherits from a layout/master placeholder. False for decorative
* geometry the slide author dropped onto the canvas. Decoupled from
* the more specific `getShapePlaceholderType` / `getShapePlaceholderIdx`
* (either can be null on a real placeholder; together they identify it).
*/
const isShapePlaceholder = (shape) => {
	const snap = shape[SHAPE_SNAPSHOT];
	return snap.placeholderType !== null || snap.placeholderIdx !== null;
};
const NAME_P_NV_SP_PR = qname("p", "nvSpPr", NS.pml);
const NAME_P_C_NV_SP_PR = qname("p", "cNvSpPr", NS.pml);
const ATTR_TX_BOX = qname("", "txBox", "");
/**
* `true` when the shape is a **text box** (`<p:cNvSpPr txBox="1">`) rather than
* an autoshape. The distinction drives default text formatting: PowerPoint /
* LibreOffice left-align and top-anchor text-box text, but center-align and
* middle-anchor autoshape text when the deck author left those unset.
*/
const isShapeTextBox = (shape) => {
	const nvSpPr = firstChildElement(shape[SHAPE_ELEMENT], NAME_P_NV_SP_PR);
	if (!nvSpPr) return false;
	const cNvSpPr = firstChildElement(nvSpPr, NAME_P_C_NV_SP_PR);
	if (!cNvSpPr) return false;
	const v = getAttrValue(cNvSpPr, ATTR_TX_BOX);
	return v === "1" || v === "true";
};
const getShapeText = (shape) => shape[SHAPE_SNAPSHOT].text;
const getShapePosition = (shape) => readPosition(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind);
const getShapeSize = (shape) => readSize(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind);
const getShapeRotation = (shape) => readRotation(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind);
const getShapeFlip = (shape) => readFlip(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind);
/**
* Enumerates the shapes nested inside a `<p:grpSp>` group, one level
* deep (nested groups come through as `kind: 'group'` themselves —
* call this again on each one to recurse).
*
* Returns an empty array for non-group shapes. Each child carries its
* own bounds in the group's *internal* coordinate system; pair with
* `getGroupTransform` to project them onto the slide.
*/
const getGroupChildren = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "group") return [];
	return readGroupChildren(shape[SHAPE_ELEMENT]).map((child) => ({
		[SHAPE_SLIDE]: shape[SHAPE_SLIDE],
		[SHAPE_ELEMENT]: child.element,
		[SHAPE_SNAPSHOT]: child
	}));
};
/**
* Returns the group's slide-relative bounds (`outer`) and the internal
* coordinate system the children's `<a:xfrm>` values live in
* (`inner`). Renderers project a child point `(cx, cy)` onto the slide
* with:
*
*   slideX = outer.x + (cx - inner.x) * (outer.w / inner.w)
*   slideY = outer.y + (cy - inner.y) * (outer.h / inner.h)
*
* Returns `null` for non-group shapes or for groups whose
* `<p:grpSpPr>` omits an `<a:xfrm>`.
*/
const getGroupTransform = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "group") return null;
	const grpSpPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "grpSpPr", NS.pml));
	if (!grpSpPr) return null;
	const xfrm = firstChildElement(grpSpPr, qname("a", "xfrm", NS.dml));
	if (!xfrm) return null;
	const off = firstChildElement(xfrm, qname("a", "off", NS.dml));
	const ext = firstChildElement(xfrm, qname("a", "ext", NS.dml));
	const chOff = firstChildElement(xfrm, qname("a", "chOff", NS.dml));
	const chExt = firstChildElement(xfrm, qname("a", "chExt", NS.dml));
	if (!off || !ext) return null;
	const parseAttr = (el, name) => {
		const raw = getAttrValue(el, qname("", name, ""));
		if (raw === null) return null;
		const n = Number.parseInt(raw, 10);
		return Number.isFinite(n) ? n : null;
	};
	const ox = parseAttr(off, "x");
	const oy = parseAttr(off, "y");
	const ow = parseAttr(ext, "cx");
	const oh = parseAttr(ext, "cy");
	if (ox === null || oy === null || ow === null || oh === null) return null;
	const ix = chOff ? parseAttr(chOff, "x") ?? ox : ox;
	const iy = chOff ? parseAttr(chOff, "y") ?? oy : oy;
	const iw = chExt ? parseAttr(chExt, "cx") ?? ow : ow;
	const ih = chExt ? parseAttr(chExt, "cy") ?? oh : oh;
	return {
		outer: {
			x: ox,
			y: oy,
			w: ow,
			h: oh
		},
		inner: {
			x: ix,
			y: iy,
			w: iw,
			h: ih
		}
	};
};
const getShapeBounds = (shape) => {
	const pos = readPosition(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind);
	const size = readSize(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind);
	if (pos === null || size === null) return null;
	return {
		x: pos.x,
		y: pos.y,
		w: size.w,
		h: size.h
	};
};
/**
* OOXML placeholder-type equivalence for inheritance. A `ctrTitle` inherits
* from a `title` placeholder (and vice versa), and a `subTitle` from `body` —
* so a centered title on a title-slide layout still picks up the master title
* placeholder's bodyPr / lstStyle / geometry. Returns the acceptable
* layout/master placeholder types for `phType`, most specific first.
*/
const placeholderTypeCandidates = (phType) => {
	if (phType === null) return [];
	if (phType === "ctrTitle") return ["ctrTitle", "title"];
	if (phType === "title") return ["title", "ctrTitle"];
	if (phType === "subTitle") return ["subTitle", "body"];
	return [phType];
};
/**
* Finds the layout/master placeholder shape that `(phIdx, phType)` inherits
* from: match by `<p:ph idx>` first, then by `<p:ph type>` using the
* equivalence above. Shared by the bounds / bodyPr / rPr / pPr resolvers so
* they agree on what a placeholder inherits.
*/
const matchPlaceholderShape = (shapes, phIdx, phType) => {
	if (phIdx !== null) {
		const byIdx = shapes.find((s) => s.placeholderIdx === phIdx);
		if (byIdx) return byIdx;
	}
	for (const t of placeholderTypeCandidates(phType)) {
		const byType = shapes.find((s) => s.placeholderType === t);
		if (byType) return byType;
	}
};
/**
* Same as `getShapeBounds` but walks the placeholder inheritance chain
* when the shape has no `<a:xfrm>` of its own:
*
*   1. The shape's own bounds.
*   2. The matching placeholder on the slide's layout (by `<p:ph idx>`,
*      falling back to `<p:ph type>`).
*   3. The matching placeholder on the layout's slide master.
*
* This is what renderers want when they need to draw a placeholder
* that the deck author left unsized — real templates only override
* geometry per placeholder when it differs from the master.
*
* Returns `null` when none of the three levels carries explicit bounds.
*/
const getShapeBoundsResolved = (pres, shape) => {
	const direct = getShapeBounds(shape);
	if (direct) return direct;
	const slide = shape[SHAPE_SLIDE];
	const layout = getSlideLayout(slide);
	if (!layout) return null;
	const phIdx = getShapePlaceholderIdx(shape);
	const phType = getShapePlaceholderType(shape);
	const findInShapes = (shapes) => {
		const match = matchPlaceholderShape(shapes, phIdx, phType);
		if (!match) return null;
		const pos = readPosition(match.element, match.kind);
		const size = readSize(match.element, match.kind);
		if (pos === null || size === null) return null;
		return {
			x: pos.x,
			y: pos.y,
			w: size.w,
			h: size.h
		};
	};
	const layoutHit = findInShapes(layout[LAYOUT_PART].shapes);
	if (layoutHit) return layoutHit;
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return null;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return null;
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return null;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const { shapes: masterShapes } = readShapeTreeFromCsldRoot(masterRoot, "sldMaster");
	return findInShapes(masterShapes);
};
/**
* Returns the center point of the shape's bounds in EMU, or `null`
* when the shape has no `<a:xfrm>`. Convenience for layout
* pipelines that compute alignment / overlap from center points.
*/
const getShapeCenter = (shape) => {
	const bounds = getShapeBounds(shape);
	if (bounds === null) return null;
	return {
		x: bounds.x + Math.round(bounds.w / 2),
		y: bounds.y + Math.round(bounds.h / 2)
	};
};
/**
* `true` when point `(x, y)` (in EMU) lies inside the shape's
* axis-aligned bounds. Closed on the top-left edge, open on the
* bottom-right (standard half-open rectangle). Returns `false`
* when the shape has no bounds.
*
* Useful for hit-testing in custom interaction handlers.
*/
const pointInShape = (shape, x, y) => {
	const bounds = getShapeBounds(shape);
	if (bounds === null) return false;
	return x >= bounds.x && x < bounds.x + bounds.w && y >= bounds.y && y < bounds.y + bounds.h;
};
/**
* Returns every shape on the slide whose bounds contain `(x, y)`
* (in EMU). Built on `pointInShape`. The list is in document
* order, so callers can index by z-stack from front (last) to
* back (first) if they want one-hit semantics.
*/
const findShapesAtPoint = (slide, x, y) => slide[SLIDE_SHAPES].filter((s) => pointInShape(s, x, y));
/**
* Returns every shape on the slide whose bounds overlap the rectangle
* `(x, y, w, h)` (in EMU). "Overlap" means the rectangles intersect at
* all — touching edges count. Shapes with no resolvable bounds (e.g.
* placeholders that inherit position from the layout) are skipped.
*
* Useful for marquee-style region selection — e.g. "give me every
* shape that lives in the right half of the slide" — without
* iterating every shape and comparing bounds by hand.
*/
const findShapesInRect = (slide, x, y, w, h) => {
	const rx2 = x + w;
	const ry2 = y + h;
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) {
		const b = getShapeBounds(shape);
		if (b === null) continue;
		const sx2 = b.x + b.w;
		const sy2 = b.y + b.h;
		if (b.x <= rx2 && sx2 >= x && b.y <= ry2 && sy2 >= y) out.push(shape);
	}
	return out;
};
/**
* Moves the shape so its center sits at the slide canvas center.
* Reads the presentation's slide size, then sets the shape's
* position to `(slideWidth/2 - shapeWidth/2, slideHeight/2 - shapeHeight/2)`.
*
* No-op when the shape has no bounds or the presentation has no
* configured slide size.
*/
const centerShapeOnSlide = (shape) => {
	const bounds = getShapeBounds(shape);
	if (bounds === null) return;
	const presPart = shape[SHAPE_SLIDE][INTERNAL_PACKAGE].getPart(PRES_PART_NAME);
	if (!presPart) return;
	const presRoot = parseXml(decode$1(presPart.data)).root;
	const model = readPresentationPart(presRoot);
	if (model.slideSize === null) return;
	setShapePosition(shape, Math.round(model.slideSize.cx / 2 - bounds.w / 2), Math.round(model.slideSize.cy / 2 - bounds.h / 2));
};
/**
* `true` when two shapes' axis-aligned bounding boxes overlap.
* Returns `false` when either shape has no bounds. Doesn't account
* for rotation — uses the raw `<a:xfrm>` rectangle, not the
* visual bounding box after rotation.
*
* Useful for collision detection in custom layout pipelines.
*/
const shapesOverlap = (a, b) => {
	const ba = getShapeBounds(a);
	const bb = getShapeBounds(b);
	if (ba === null || bb === null) return false;
	return ba.x < bb.x + bb.w && ba.x + ba.w > bb.x && ba.y < bb.y + bb.h && ba.y + ba.h > bb.y;
};
/**
* Sets both position and size in one call. Equivalent to calling
* `setShapePosition` followed by `setShapeSize`, but commits the slide
* just once.
*/
const setShapeBounds = (shape, bounds) => {
	setPosition(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind, bounds.x, bounds.y);
	setSize(shape[SHAPE_ELEMENT], shape[SHAPE_SNAPSHOT].kind, bounds.w, bounds.h);
	commitAndRefresh(shape);
};
/**
* Reads back the fill choice on the shape's `<p:spPr>`. Returns:
*
*   - `{ kind: 'solid', color: '#RRGGBB' }` for a solid sRGB fill.
*   - `{ kind: 'solid', color: 'scheme:accent1' }` for a scheme color.
*   - `{ kind: 'gradient' }` / `'pattern'` / `'image'` for those choices
*     (without breaking out their parameters — call the dedicated
*     setter to overwrite).
*   - `{ kind: 'none' }` for `<a:noFill>`.
*   - `{ kind: 'inherit' }` when no fill choice is present on this
*     shape (it inherits from the layout / master placeholder).
*/
//#endregion
//#region src/api/fn/shape-slide-read.ts
/**
* Shapes on a slide, in document order with group children flattened.
*/
const getSlideShapes = (slide) => slide[SLIDE_SHAPES];
/**
* Rebinds the slide to a different layout. The slide's own content
* (shapes, text, geometry) is preserved verbatim; only the
* `slideLayout` rel is updated so PowerPoint re-renders with the new
* layout's placeholder positions and theme.
*
* The new layout must already be a part of the package — pass one
* returned by `getSlideLayouts(pres)` or `findSlideLayout(pres, name)`.
*/
const setSlideLayout = (slide, layout) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const layoutPartName = layout[LAYOUT_PART_NAME];
	if (pkg.getPart(layoutPartName) === null) throw new Error(`setSlideLayout: layout ${layoutPartName} not in package`);
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
	const newTarget = `../slideLayouts/${basename(layoutPartName)}`;
	const existing = rels.items.find((r) => r.type === REL_TYPES.slideLayout);
	if (existing) existing.target = newTarget;
	else rels.items.push({
		id: nextRelId(rels.items.map((r) => r.id)),
		type: REL_TYPES.slideLayout,
		target: newTarget,
		targetMode: "Internal"
	});
	pkg.setRels(slide[SLIDE_PART_NAME], rels);
};
/**
* The slide layout this slide is bound to, or `null` if the slide has
* no layout relationship.
*/
const getSlideLayout = (slide) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (rels === null) return null;
	const layoutRel = rels.items.find((r) => r.type === REL_TYPES.slideLayout);
	if (!layoutRel) return null;
	const layoutName = layoutRel.target.startsWith("/") ? partName(layoutRel.target) : resolveTarget(slide[SLIDE_PART_NAME], layoutRel.target);
	const layoutPart = pkg.getPart(layoutName);
	if (layoutPart === null) return null;
	const root = parseXml(decode$1(layoutPart.data)).root;
	return {
		[LAYOUT_PART_NAME]: layoutName,
		[LAYOUT_PART]: readSlideLayoutPart(root)
	};
};
/**
* Returns the first placeholder shape with the given `type` (or `null`
* if no match). Shapes whose `<p:ph>` omits an explicit type default to
* `'body'` per ECMA-376 §19.7.10.
*/
const findSlidePlaceholder = (slide, type) => {
	for (const shape of slide[SLIDE_SHAPES]) {
		const snap = shape[SHAPE_SNAPSHOT];
		if (snap.placeholderType === type) return shape;
		if (type === "body" && snap.placeholderType === null && snap.placeholderIdx !== null) return shape;
	}
	return null;
};
/**
* Returns every placeholder shape on the slide whose text body is
* empty. Useful for "spot the slots that still need filling" UIs
* before a slide is published, and for validation hooks that warn
* about empty slots.
*/
const findEmptyPlaceholders = (slide) => {
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) {
		if (!isShapePlaceholder(shape)) continue;
		if (hasShapeText(shape)) continue;
		out.push(shape);
	}
	return out;
};
/**
* Returns the union bounding box of a group of shapes, or `null`
* when none of them have bounds. Useful for "select all and move
* together" patterns where the caller needs a single rectangle
* across the group.
*/
const getShapesBounds = (shapes) => {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let found = false;
	for (const shape of shapes) {
		const b = getShapeBounds(shape);
		if (!b) continue;
		found = true;
		if (b.x < minX) minX = b.x;
		if (b.y < minY) minY = b.y;
		if (b.x + b.w > maxX) maxX = b.x + b.w;
		if (b.y + b.h > maxY) maxY = b.y + b.h;
	}
	if (!found) return null;
	return {
		x: minX,
		y: minY,
		w: maxX - minX,
		h: maxY - minY
	};
};
/**
* Translates every shape in `shapes` by `(dxEmu, dyEmu)`. Useful
* for "move this group of shapes 1cm right" patterns without
* looping yourself. Shapes without bounds are skipped silently.
*/
const translateShapes = (shapes, dxEmu, dyEmu) => {
	for (const shape of shapes) {
		const bounds = getShapeBounds(shape);
		if (bounds === null) continue;
		setShapePosition(shape, bounds.x + dxEmu, bounds.y + dyEmu);
	}
};
/**
* Returns every slide in the deck that has at least one empty
* placeholder shape. Built on `findEmptyPlaceholders`. Useful for
* "which slides still need editorial attention?" pre-publish
* audits.
*/
const getSlidesWithEmptyPlaceholders = (pres) => {
	const out = [];
	for (const slide of getSlides(pres)) if (findEmptyPlaceholders(slide).length > 0) out.push(slide);
	return out;
};
/**
* Returns the first placeholder shape whose `<p:ph idx="...">`
* matches `idx`, or `null` when none does. Real templates often
* disambiguate same-type placeholders (e.g. two body slots) by
* `idx`, so this is what you reach for when type-only lookup is
* ambiguous.
*/
const findSlidePlaceholderByIdx = (slide, idx) => {
	for (const shape of slide[SLIDE_SHAPES]) if (shape[SHAPE_SNAPSHOT].placeholderIdx === idx) return shape;
	return null;
};
/**
* Returns every placeholder shape with the given `type`. Useful for
* "two-content" / "comparison" layouts where multiple body
* placeholders share a type and the caller needs to fill them all.
* Like `findSlidePlaceholder`, omitted `<p:ph type>` is treated as
* `body` per ECMA-376 §19.7.10.
*/
const findSlidePlaceholders = (slide, type) => {
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) {
		const snap = shape[SHAPE_SNAPSHOT];
		if (snap.placeholderType === type) {
			out.push(shape);
			continue;
		}
		if (type === "body" && snap.placeholderType === null && snap.placeholderIdx !== null) out.push(shape);
	}
	return out;
};
/**
* First shape on the slide whose `cNvPr@name` matches `name`. Accepts
* either a literal string (exact-equality) or a `RegExp` for pattern
* matches — mirroring `findShapeByText`. Returns `null` when nothing
* matches.
*/
const findShapeByName = (slide, name) => {
	if (typeof name === "string") {
		for (const shape of slide[SLIDE_SHAPES]) if (shape[SHAPE_SNAPSHOT].name === name) return shape;
		return null;
	}
	for (const shape of slide[SLIDE_SHAPES]) if (name.test(shape[SHAPE_SNAPSHOT].name)) return shape;
	return null;
};
/**
* Returns the shape with the given OOXML internal id (`cNvPr@id`), or
* `null` when no such shape exists. Shape ids are unique within a
* slide; pair with `getShapeId` to round-trip references that arrive
* from external XML (e.g. animations, hyperlinks).
*/
const findShapeById = (slide, id) => {
	for (const shape of slide[SLIDE_SHAPES]) if (shape[SHAPE_SNAPSHOT].id === id) return shape;
	return null;
};
/**
* Every shape on the slide whose `cNvPr@name` matches `name`. Accepts
* either a literal string (exact-equality, case-sensitive) or a
* `RegExp` for pattern matches — useful when template-cloned shapes
* share a prefix (`'TextPlaceholder1'`, `'TextPlaceholder2'`, …).
*/
const findShapesByName = (slide, name) => {
	if (typeof name === "string") return slide[SLIDE_SHAPES].filter((s) => s[SHAPE_SNAPSHOT].name === name);
	return slide[SLIDE_SHAPES].filter((s) => name.test(s[SHAPE_SNAPSHOT].name));
};
/**
* First shape on the slide whose visible text matches `needle`
* (substring or `RegExp`), or `null` when none does. Convenience
* over `getSlideShapes(slide).find(...)` when the caller is hunting
* for a label in a template ("find the box that says 'Q1'").
*/
const findShapeByText = (slide, needle) => {
	for (const shape of slide[SLIDE_SHAPES]) {
		const text = shape[SHAPE_SNAPSHOT].text;
		if (typeof needle === "string" ? text.includes(needle) : needle.test(text)) return shape;
	}
	return null;
};
/**
* Every shape on the slide whose visible text matches `needle`. Use
* when more than one shape can share the same text (common with
* cloned bullet templates) — multi-match variant of
* `findShapeByText`.
*/
const findShapesByText = (slide, needle) => {
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) {
		const text = shape[SHAPE_SNAPSHOT].text;
		if (typeof needle === "string" ? text.includes(needle) : needle.test(text)) out.push(shape);
	}
	return out;
};
/** Every shape on the slide of the given kind. */
const findShapesByKind = (slide, kind) => slide[SLIDE_SHAPES].filter((s) => s[SHAPE_SNAPSHOT].kind === kind);
/**
* Every shape on the slide whose hyperlink target matches `url`
* (substring or `RegExp`). Pairs the existing presentation-level
* `findSlidesByHyperlink` for cases where the caller already has a
* specific slide and wants the linking shapes inside it.
*/
const findShapesByHyperlink = (slide, url) => {
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) {
		const target = getShapeHyperlink(shape);
		if (target === null) continue;
		if (typeof url === "string" ? target.includes(url) : url.test(target)) out.push(shape);
	}
	return out;
};
/**
* Every shape on the slide that carries any hyperlink (regardless of
* target). Useful for "audit every clickable shape on this slide" —
* counterpart to `findShapesByHyperlink(slide, url)`, which requires a
* matching URL.
*/
const findShapesWithHyperlinks = (slide) => {
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) if (getShapeHyperlink(shape) !== null) out.push(shape);
	return out;
};
/**
* Returns every shape on the slide whose `<a:prstGeom prst="…"/>`
* token matches `preset`. Useful for diagram introspection: find all
* `'leftArrow'` shapes for a workflow swap, replace every `'cloud'`
* with `'rect'`, etc.
*
* Shapes without a preset (custGeom / pictures / charts / tables /
* connectors / groups) are filtered out.
*/
const findShapesByPreset = (slide, preset) => slide[SLIDE_SHAPES].filter((s) => getShapePreset(s) === preset);
/**
* Returns the slide that owns `shape`. Useful when callers receive a
* shape from an unfiltered walk (`getAllShapes`, `findShapeInPresentation`,
* search results) and need to know which slide it's on.
*/
const getShapeSlide = (shape) => shape[SHAPE_SLIDE];
/**
* Returns the shape's current XML element as a string. Diagnostic
* sibling of `getSlideXmlString`; useful for snapshot tests, bug
* reports, and before/after dumps during transformations.
*/
const getShapeXmlString = (shape) => serializeXml({
	kind: "document",
	decl: null,
	root: shape[SHAPE_ELEMENT],
	prolog: [],
	epilog: []
});
/**
* Returns the 0-based document-order index of `shape` on its slide,
* or `-1` when the shape is stale (e.g. after a `removeShape` that
* rebuilt the slide's shape list).
*/
const getShapeIndex = (shape) => {
	return shape[SHAPE_SLIDE][SLIDE_SHAPES].indexOf(shape);
};
/**
* Walks every slide and returns the first shape whose name matches.
* Accepts a literal string (exact equality) or a `RegExp` for
* pattern matches — same shape as `findShapeByName` but deck-scoped.
* Useful for "find the logo placeholder anywhere in the deck."
*/
const findShapeInPresentation = (pres, name) => {
	for (const slide of getSlides(pres)) {
		const hit = findShapeByName(slide, name);
		if (hit !== null) return hit;
	}
	return null;
};
/**
* Replaces `{{key}}` tokens in every text-bearing shape on this slide.
* Returns the number of substitutions performed.
*
* Tokens must fit within a single text run (see `replaceTokensInTree`
* in `drawingml/`). Cross-run replacements aren't supported — use
* `findSlidePlaceholder` + a setText path when PowerPoint has
* fragmented the run sequence.
*/
const replaceTokensInSlide = (slide, tokens) => {
	const n = replaceTokensInTree(slide[SLIDE_DOCUMENT].root, tokens);
	if (n > 0) {
		commitSlideData(slide);
		refreshSlideData(slide);
	}
	return n;
};
//#endregion
//#region src/api/fn/shape-read-paint.ts
const solidFillColorElement = (container) => {
	const solid = firstChildElement(container, qname("a", "solidFill", NS.dml));
	if (!solid) return null;
	for (const inner of solid.children) if (inner.kind === "element" && inner.name.namespaceURI === NS.dml) return inner;
	return null;
};
const fillColorElement = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	return spPr ? solidFillColorElement(spPr) : null;
};
const strokeColorElement = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	const ln = spPr ? firstChildElement(spPr, qname("a", "ln", NS.dml)) : null;
	return ln ? solidFillColorElement(ln) : null;
};
/**
* Convenience over `getShapeStroke(shape)`: returns the solid-
* stroke color (`#RRGGBB` / `scheme:<token>`) or `null` when the
* stroke is inherited / removed.
*/
const getShapeStrokeColor = (shape) => {
	const stroke = getShapeStroke(shape);
	return stroke.kind === "solid" ? stroke.color : null;
};
/**
* Convenience over `getShapeStroke(shape)`: returns the stroke
* width in EMU when the stroke is solid and an explicit width is
* set, or `null` otherwise.
*/
const getShapeStrokeWidth = (shape) => {
	const stroke = getShapeStroke(shape);
	return stroke.kind === "solid" && stroke.widthEmu !== void 0 ? stroke.widthEmu : null;
};
/**
* Returns the shape's stroke color resolved to a concrete `#RRGGBB`:
* scheme tokens are mapped through the deck's color scheme and
* `<a:lumMod>` / `<a:tint>` / `<a:shade>` / etc. transform children
* are applied. Returns `null` when the stroke isn't a solid color
* (inherits / `noFill`) or when the color can't be resolved.
*
* Companion to `getShapeStrokeColor`, which surfaces only the raw
* `#RRGGBB` / `scheme:<token>` string — fine for round-tripping but
* wrong for rendering, because PowerPoint paints the *transformed*
* color, not the base one.
*/
const getShapeStrokeColorResolved = (pres, shape) => {
	const color = strokeColorElement(shape);
	return color ? resolveDrawingColor(color, getPresentationTheme(pres)) : null;
};
/**
* Returns the opacity (`0`–`1`) of the shape's own solid outline, read from
* the `<a:alpha>` / `<a:alphaMod>` / `<a:alphaOff>` children of its color
* element, or `null` when the outline isn't a solid color or carries no
* alpha transform (PowerPoint draws it fully opaque). Companion to
* `getShapeStrokeColorResolved`, which never carries the alpha channel.
*/
const getShapeStrokeOpacity = (shape) => {
	const color = strokeColorElement(shape);
	return color ? resolveDrawingColorOpacity(color) : null;
};
/**
* Reads the stroke's line cap style — `'rnd'` (round), `'sq'` (square),
* `'flat'`, or `null` when the attribute isn't set. Per ECMA-376
* §20.1.2.3.10 (`ST_LineCap`).
*/
const getShapeStrokeCap = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
	if (!ln) return null;
	const v = getAttrValue(ln, qname("", "cap", ""));
	if (v === "rnd" || v === "sq" || v === "flat") return v;
	return null;
};
/**
* Reads the stroke's line join style — `'round'` / `'bevel'` / `'miter'`,
* or `null` when no explicit join element is present. Maps from the
* three child-element variants `<a:round/>`, `<a:bevel/>`, `<a:miter/>`.
*/
const getShapeStrokeJoin = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
	if (!ln) return null;
	for (const c of ln.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "round") return "round";
		if (c.name.localName === "bevel") return "bevel";
		if (c.name.localName === "miter") return "miter";
	}
	return null;
};
/**
* Reads the stroke's compound-line style (`<a:ln cmpd="…">`) — single,
* double, triple, or thick/thin / thin/thick parallel lines. ECMA-376
* §20.1.2.3.11 (`ST_CompoundLine`).
*/
const getShapeStrokeCompound = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
	if (!ln) return null;
	const v = getAttrValue(ln, qname("", "cmpd", ""));
	if (v === "sng" || v === "dbl" || v === "thickThin" || v === "thinThick" || v === "tri") return v;
	return null;
};
/**
* Same as `getShapeStroke` but walks the layout → master placeholder
* cascade when the shape itself reports `'inherit'`. First non-inherit
* stroke layer wins.
*/
const getShapeStrokeEffective = (pres, shape) => {
	const own = getShapeStroke(shape);
	if (own.kind !== "inherit") return own;
	const phIdx = getShapePlaceholderIdx(shape);
	const phType = getShapePlaceholderType(shape);
	if (phIdx === null && phType === null) return own;
	const layout = getSlideLayout(shape[SHAPE_SLIDE]);
	if (!layout) return own;
	const readStrokeFromSpPr = (el) => {
		const spPr = firstChildElement(el, qname("p", "spPr", NS.pml));
		if (!spPr) return null;
		const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
		if (!ln) return null;
		const wRaw = getAttrValue(ln, qname("", "w", ""));
		const widthEmu = wRaw !== null ? Number.parseInt(wRaw, 10) : void 0;
		for (const c of ln.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			if (c.name.localName === "noFill") return { kind: "none" };
			if (c.name.localName === "solidFill") for (const inner of c.children) {
				if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
				if (inner.name.localName === "srgbClr") {
					const val = getAttrValue(inner, qname("", "val", ""));
					if (val !== null) return {
						kind: "solid",
						color: `#${val.toUpperCase()}`,
						...widthEmu !== void 0 ? { widthEmu } : {}
					};
				}
				if (inner.name.localName === "schemeClr") {
					const val = getAttrValue(inner, qname("", "val", ""));
					if (val !== null) return {
						kind: "solid",
						color: `scheme:${val}`,
						...widthEmu !== void 0 ? { widthEmu } : {}
					};
				}
			}
		}
		return null;
	};
	const findPh = (shapes) => {
		let match = phIdx !== null ? shapes.find((s) => s.placeholderIdx === phIdx) : void 0;
		if (!match && phType !== null) match = shapes.find((s) => s.placeholderType === phType);
		return match?.element ?? null;
	};
	const layoutPh = findPh(layout[LAYOUT_PART].shapes);
	if (layoutPh) {
		const s = readStrokeFromSpPr(layoutPh);
		if (s) return s;
	}
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return own;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return own;
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return own;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const { shapes: masterShapes } = readShapeTreeFromCsldRoot(masterRoot, "sldMaster");
	const masterPh = findPh(masterShapes);
	if (masterPh) {
		const s = readStrokeFromSpPr(masterPh);
		if (s) return s;
	}
	return own;
};
const getShapeStroke = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return { kind: "inherit" };
	const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
	if (!ln) return { kind: "inherit" };
	const wRaw = getAttrValue(ln, qname("", "w", ""));
	const widthEmu = wRaw !== null ? Number.parseInt(wRaw, 10) : void 0;
	for (const c of ln.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "noFill") return { kind: "none" };
		if (c.name.localName === "solidFill") {
			for (const inner of c.children) {
				if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
				if (inner.name.localName === "srgbClr") {
					const val = getAttrValue(inner, qname("", "val", ""));
					if (val !== null) return {
						kind: "solid",
						color: `#${val.toUpperCase()}`,
						...widthEmu !== void 0 ? { widthEmu } : {}
					};
				}
				if (inner.name.localName === "schemeClr") {
					const val = getAttrValue(inner, qname("", "val", ""));
					if (val !== null) return {
						kind: "solid",
						color: `scheme:${val}`,
						...widthEmu !== void 0 ? { widthEmu } : {}
					};
				}
			}
			return {
				kind: "solid",
				color: "",
				...widthEmu !== void 0 ? { widthEmu } : {}
			};
		}
	}
	return { kind: "inherit" };
};
/**
* Convenience over `getShapeFill(shape)`: returns the solid-fill
* color string (`#RRGGBB` or `scheme:<token>`) when the shape has
* one, or `null` otherwise. Use when the caller only cares about
* the color and doesn't need to distinguish "inherit" / "no fill" /
* "gradient" / "pattern" / "image" from each other.
*/
const getShapeFillColor = (shape) => {
	const fill = getShapeFill(shape);
	return fill.kind === "solid" ? fill.color : null;
};
/**
* Returns the shape's solid fill resolved to a concrete `#RRGGBB`:
* scheme tokens are mapped through the deck's color scheme and
* `<a:lumMod>` / `<a:tint>` / `<a:shade>` / etc. transform children
* are applied. Returns `null` when the fill isn't solid (gradient,
* pattern, image, none, inherit) or when the color can't be resolved.
*
* Companion to `getShapeFillColor`, which surfaces only the raw
* `#RRGGBB` / `scheme:<token>` string. Renderers and exporters that
* need the color PowerPoint actually paints should call this.
*/
const getShapeFillColorResolved = (pres, shape) => {
	const color = fillColorElement(shape);
	return color ? resolveDrawingColor(color, getPresentationTheme(pres)) : null;
};
/**
* Returns the opacity (`0`–`1`) of the shape's own solid fill, read from
* the `<a:alpha>` / `<a:alphaMod>` / `<a:alphaOff>` children of its color
* element, or `null` when the fill isn't solid or carries no alpha
* transform (PowerPoint paints it fully opaque). Companion to
* `getShapeFillColorResolved`, which never carries the alpha channel —
* OOXML encodes color and alpha independently.
*/
const getShapeFillOpacity = (shape) => {
	const color = fillColorElement(shape);
	return color ? resolveDrawingColorOpacity(color) : null;
};
/**
* Same as `getShapeFill` but walks the layout → master placeholder
* cascade when the shape itself reports `'inherit'`. Returns the first
* non-inherit fill found, or `{ kind: 'inherit' }` when neither layer
* supplies one. Useful for renderers that want the actual fill the
* placeholder will paint with.
*/
const getShapeFillEffective = (pres, shape) => {
	const own = getShapeFill(shape);
	if (own.kind !== "inherit") return own;
	const phIdx = getShapePlaceholderIdx(shape);
	const phType = getShapePlaceholderType(shape);
	if (phIdx === null && phType === null) return own;
	const layout = getSlideLayout(shape[SHAPE_SLIDE]);
	if (!layout) return own;
	const readFillFromSpPr = (el) => {
		const spPr = firstChildElement(el, qname("p", "spPr", NS.pml));
		if (!spPr) return null;
		for (const c of spPr.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			switch (c.name.localName) {
				case "noFill": return { kind: "none" };
				case "solidFill":
					for (const inner of c.children) {
						if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
						if (inner.name.localName === "srgbClr") {
							const val = getAttrValue(inner, qname("", "val", ""));
							if (val !== null) return {
								kind: "solid",
								color: `#${val.toUpperCase()}`
							};
						}
						if (inner.name.localName === "schemeClr") {
							const val = getAttrValue(inner, qname("", "val", ""));
							if (val !== null) return {
								kind: "solid",
								color: `scheme:${val}`
							};
						}
					}
					return {
						kind: "solid",
						color: ""
					};
				case "gradFill": return { kind: "gradient" };
				case "pattFill": return { kind: "pattern" };
				case "blipFill": return { kind: "image" };
			}
		}
		return null;
	};
	const findPh = (shapes) => {
		let match = phIdx !== null ? shapes.find((s) => s.placeholderIdx === phIdx) : void 0;
		if (!match && phType !== null) match = shapes.find((s) => s.placeholderType === phType);
		return match?.element ?? null;
	};
	const layoutPh = findPh(layout[LAYOUT_PART].shapes);
	if (layoutPh) {
		const f = readFillFromSpPr(layoutPh);
		if (f) return f;
	}
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return own;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return own;
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return own;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const { shapes: masterShapes } = readShapeTreeFromCsldRoot(masterRoot, "sldMaster");
	const masterPh = findPh(masterShapes);
	if (masterPh) {
		const f = readFillFromSpPr(masterPh);
		if (f) return f;
	}
	return own;
};
const getShapeFill = (shape) => {
	const spPrName = qname("p", "spPr", NS.pml);
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], spPrName);
	if (!spPr) return { kind: "inherit" };
	for (const c of spPr.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		switch (c.name.localName) {
			case "noFill": return { kind: "none" };
			case "solidFill":
				for (const inner of c.children) {
					if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml) continue;
					if (inner.name.localName === "srgbClr") {
						const val = getAttrValue(inner, qname("", "val", ""));
						if (val !== null) return {
							kind: "solid",
							color: `#${val.toUpperCase()}`
						};
					}
					if (inner.name.localName === "schemeClr") {
						const val = getAttrValue(inner, qname("", "val", ""));
						if (val !== null) return {
							kind: "solid",
							color: `scheme:${val}`
						};
					}
				}
				return {
					kind: "solid",
					color: ""
				};
			case "gradFill": return { kind: "gradient" };
			case "pattFill": return { kind: "pattern" };
			case "blipFill": return { kind: "image" };
		}
	}
	return { kind: "inherit" };
};
//#endregion
//#region src/api/fn/shape-gradient-read.ts
const NAME_A_GRAD_FILL = qname("a", "gradFill", NS.dml);
const NAME_A_GS_LST = qname("a", "gsLst", NS.dml);
const NAME_A_LIN = qname("a", "lin", NS.dml);
const readColorFromContainer = (parent) => {
	for (const c of parent.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "srgbClr") {
			const val = getAttrValue(c, qname("", "val", ""));
			if (val !== null) return `#${val.toUpperCase()}`;
		}
		if (c.name.localName === "schemeClr") {
			const val = getAttrValue(c, qname("", "val", ""));
			if (val !== null) return `scheme:${val}`;
		}
	}
	return null;
};
const parseGradFill = (gradFill) => {
	const gsLst = firstChildElement(gradFill, NAME_A_GS_LST);
	if (!gsLst) return null;
	const stops = [];
	for (const c of gsLst.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml || c.name.localName !== "gs") continue;
		const posRaw = getAttrValue(c, qname("", "pos", ""));
		if (posRaw === null) continue;
		const pos = Number.parseInt(posRaw, 10);
		if (!Number.isFinite(pos)) continue;
		const color = readColorFromContainer(c);
		if (color === null) continue;
		stops.push({
			offset: pos / 1e5,
			color
		});
	}
	if (stops.length === 0) return null;
	let angleDeg = 0;
	const lin = firstChildElement(gradFill, NAME_A_LIN);
	if (lin) {
		const angRaw = getAttrValue(lin, qname("", "ang", ""));
		if (angRaw !== null) {
			const ang = Number.parseInt(angRaw, 10);
			if (Number.isFinite(ang)) angleDeg = ang / 6e4;
		}
	}
	const pathEl = firstChildElement(gradFill, qname("a", "path", NS.dml));
	if (pathEl) {
		const p = getAttrValue(pathEl, qname("", "path", ""));
		const pathVal = p === "circle" || p === "rect" || p === "shape" ? p : null;
		if (pathVal) {
			let focus;
			const fillToRect = firstChildElement(pathEl, qname("a", "fillToRect", NS.dml));
			if (fillToRect) {
				const pct = (name) => {
					const v = getAttrValue(fillToRect, qname("", name, ""));
					if (v === null) return void 0;
					let n = Number.parseFloat(v);
					if (!Number.isFinite(n)) return void 0;
					if (Math.abs(n) > 1) n = n / 1e5;
					return n;
				};
				focus = {
					left: pct("l") ?? .5,
					top: pct("t") ?? .5,
					right: pct("r") ?? .5,
					bottom: pct("b") ?? .5
				};
			}
			return {
				stops,
				angleDeg,
				path: pathVal,
				...focus ? { focus } : {}
			};
		}
	}
	return {
		stops,
		angleDeg
	};
};
/**
* Returns the full gradient definition (`stops` + `angleDeg`) when the
* shape's `<p:spPr>` carries an `<a:gradFill>`. Returns `null` for any
* other fill kind, including `inherit` — the function does not walk the
* layout / master cascade. Use `getShapeGradientFillEffective` for that.
*/
const getShapeGradientFill = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const gradFill = firstChildElement(spPr, NAME_A_GRAD_FILL);
	if (!gradFill) return null;
	return parseGradFill(gradFill);
};
/**
* Same as `getShapeGradientFill` but walks the layout → master
* placeholder cascade when the shape itself carries no `<a:gradFill>`.
* Returns the first gradient found, or `null` when neither the shape
* nor its inherited placeholder defines one.
*
* Resolves only gradients authored as a literal `<a:gradFill>` on the
* shape or its placeholder ancestors. Gradients referenced through the
* theme style matrix (`<p:style><a:fillRef>` → `<a:fillStyleLst>`) are
* not modelled by the core yet, so those still report `inherit` and
* fall through here.
*/
const getShapeGradientFillEffective = (pres, shape) => {
	const own = getShapeGradientFill(shape);
	if (own) return own;
	const phIdx = getShapePlaceholderIdx(shape);
	const phType = getShapePlaceholderType(shape);
	if (phIdx === null && phType === null) return null;
	const layout = getSlideLayout(shape[SHAPE_SLIDE]);
	if (!layout) return null;
	const readGradFromSpPr = (el) => {
		const spPr = firstChildElement(el, qname("p", "spPr", NS.pml));
		if (!spPr) return null;
		const gradFill = firstChildElement(spPr, NAME_A_GRAD_FILL);
		if (!gradFill) return null;
		return parseGradFill(gradFill);
	};
	const findPh = (shapes) => {
		let match = phIdx !== null ? shapes.find((s) => s.placeholderIdx === phIdx) : void 0;
		if (!match && phType !== null) match = shapes.find((s) => s.placeholderType === phType);
		return match?.element ?? null;
	};
	const layoutPh = findPh(layout[LAYOUT_PART].shapes);
	if (layoutPh) {
		const g = readGradFromSpPr(layoutPh);
		if (g) return g;
	}
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return null;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return null;
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return null;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const { shapes: masterShapes } = readShapeTreeFromCsldRoot(masterRoot, "sldMaster");
	const masterPh = findPh(masterShapes);
	if (masterPh) {
		const g = readGradFromSpPr(masterPh);
		if (g) return g;
	}
	return null;
};
//#endregion
//#region src/api/fn/shape-effects.ts
const getShapeEffect = (shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return null;
	const effectLst = firstChildElement(spPr, qname("a", "effectLst", NS.dml));
	if (!effectLst) return null;
	const readColor = (host) => {
		const srgb = firstChildElement(host, qname("a", "srgbClr", NS.dml));
		if (!srgb) return { color: "" };
		const val = getAttrValue(srgb, qname("", "val", ""));
		const color = val !== null ? `#${val.toUpperCase()}` : "";
		const alpha = firstChildElement(srgb, qname("a", "alpha", NS.dml));
		if (alpha) {
			const a = getAttrValue(alpha, qname("", "val", ""));
			if (a !== null) {
				const n = Number.parseInt(a, 10);
				if (Number.isFinite(n)) return {
					color,
					opacity: n / 1e5
				};
			}
		}
		return { color };
	};
	const outerShdw = firstChildElement(effectLst, qname("a", "outerShdw", NS.dml));
	if (outerShdw) {
		const blur = Number.parseInt(getAttrValue(outerShdw, qname("", "blurRad", "")) ?? "0", 10);
		const dist = Number.parseInt(getAttrValue(outerShdw, qname("", "dist", "")) ?? "0", 10);
		const dirRaw = Number.parseInt(getAttrValue(outerShdw, qname("", "dir", "")) ?? "0", 10);
		const c = readColor(outerShdw);
		return {
			kind: "shadow",
			color: c.color,
			blurEmu: blur,
			offsetEmu: dist,
			angleDeg: dirRaw / 6e4,
			...c.opacity !== void 0 ? { opacity: c.opacity } : {}
		};
	}
	const glow = firstChildElement(effectLst, qname("a", "glow", NS.dml));
	if (glow) {
		const rad = Number.parseInt(getAttrValue(glow, qname("", "rad", "")) ?? "0", 10);
		return {
			kind: "glow",
			color: readColor(glow).color,
			radiusEmu: rad
		};
	}
	return null;
};
/**
* Returns every effect attached to the shape's `<a:effectLst>` in
* document order — outer shadow, inner shadow, glow, reflection,
* soft edge, blur. Empty array when no effects apply.
*
* Companion to `getShapeEffect`, which is the v1 "first effect only"
* helper. `getShapeEffects` is what renderers want because PowerPoint
* composes multiple effects in a single filter (shadow + glow, etc.).
*/
const parseEffectLst = (effectLst, theme) => {
	const readEffectColor = (host) => {
		let inner = null;
		for (const c of host.children) {
			if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
			if (c.name.localName === "srgbClr" || c.name.localName === "schemeClr" || c.name.localName === "sysClr" || c.name.localName === "prstClr") {
				inner = c;
				break;
			}
		}
		if (!inner) return { color: "" };
		let opacity;
		const alphaEl = firstChildElement(inner, qname("a", "alpha", NS.dml));
		if (alphaEl) {
			const a = getAttrValue(alphaEl, qname("", "val", ""));
			if (a !== null) {
				let n = Number.parseFloat(a);
				if (Number.isFinite(n)) {
					if (Math.abs(n) > 1) n = n / 1e5;
					opacity = n;
				}
			}
		}
		return {
			color: resolveDrawingColor(inner, theme) ?? "",
			...opacity !== void 0 ? { opacity } : {}
		};
	};
	const out = [];
	for (const child of effectLst.children) {
		if (child.kind !== "element" || child.name.namespaceURI !== NS.dml) continue;
		const local = child.name.localName;
		if (local === "outerShdw" || local === "innerShdw") {
			const blur = Number.parseInt(getAttrValue(child, qname("", "blurRad", "")) ?? "0", 10) || 0;
			const dist = Number.parseInt(getAttrValue(child, qname("", "dist", "")) ?? "0", 10) || 0;
			const dir = Number.parseInt(getAttrValue(child, qname("", "dir", "")) ?? "0", 10) || 0;
			const c = readEffectColor(child);
			out.push({
				kind: local,
				color: c.color,
				blurEmu: blur,
				distEmu: dist,
				angleDeg: dir / 6e4,
				...c.opacity !== void 0 ? { opacity: c.opacity } : {}
			});
		} else if (local === "glow") {
			const rad = Number.parseInt(getAttrValue(child, qname("", "rad", "")) ?? "0", 10) || 0;
			const c = readEffectColor(child);
			out.push({
				kind: "glow",
				color: c.color,
				radiusEmu: rad,
				...c.opacity !== void 0 ? { opacity: c.opacity } : {}
			});
		} else if (local === "reflection") {
			const blur = Number.parseInt(getAttrValue(child, qname("", "blurRad", "")) ?? "0", 10) || 0;
			const dist = Number.parseInt(getAttrValue(child, qname("", "dist", "")) ?? "0", 10) || 0;
			const dir = Number.parseInt(getAttrValue(child, qname("", "dir", "")) ?? "0", 10) || 0;
			const pctFraction = (name) => {
				const raw = getAttrValue(child, qname("", name, ""));
				if (raw === null) return void 0;
				let n = Number.parseFloat(raw);
				if (!Number.isFinite(n)) return void 0;
				if (Math.abs(n) > 1) n = n / 1e5;
				return n;
			};
			const opacity = pctFraction("endA");
			const startOpacity = pctFraction("stA");
			const scaleY = pctFraction("sy");
			out.push({
				kind: "reflection",
				blurEmu: blur,
				distEmu: dist,
				angleDeg: dir / 6e4,
				...opacity !== void 0 ? { opacity } : {},
				...startOpacity !== void 0 ? { startOpacity } : {},
				...scaleY !== void 0 ? { scaleY } : {}
			});
		} else if (local === "softEdge") {
			const rad = Number.parseInt(getAttrValue(child, qname("", "rad", "")) ?? "0", 10) || 0;
			out.push({
				kind: "softEdge",
				radiusEmu: rad
			});
		} else if (local === "blur") {
			const rad = Number.parseInt(getAttrValue(child, qname("", "rad", "")) ?? "0", 10) || 0;
			out.push({
				kind: "blur",
				radiusEmu: rad
			});
		}
	}
	return out;
};
const getShapeEffects = (pres, shape) => {
	const spPr = firstChildElement(shape[SHAPE_ELEMENT], qname("p", "spPr", NS.pml));
	if (!spPr) return [];
	const effectLst = firstChildElement(spPr, qname("a", "effectLst", NS.dml));
	if (!effectLst) return [];
	return parseEffectLst(effectLst, getPresentationTheme(pres));
};
/**
* Every shape on the slide whose `<a:effectLst>` carries an effect
* of the given `kind` (`'outerShdw'`, `'innerShdw'`, `'glow'`,
* `'reflection'`, `'softEdge'`, `'blur'`). Pure presence check — only
* looks at the shape's own effect list, not the layout / master
* cascade. Pair with `findShapesByEffect(pres, slide, 'softEdge')`
* style call sites for visual-effect audits.
*/
const findShapesByEffect = (pres, slide, kind) => {
	const out = [];
	for (const shape of slide[SLIDE_SHAPES]) if (getShapeEffects(pres, shape).some((e) => e.kind === kind)) out.push(shape);
	return out;
};
/**
* Same as `getShapeEffects` but walks the layout → master placeholder
* cascade when the shape itself has no `<a:effectLst>`. Inherits
* "all or nothing" — once any layer supplies an effect list, that
* list is used; layers further down aren't merged in. This matches
* PowerPoint's behaviour (effect lists override rather than compose).
*/
const getShapeEffectsEffective = (pres, shape) => {
	const own = getShapeEffects(pres, shape);
	if (own.length > 0) return own;
	const phIdx = getShapePlaceholderIdx(shape);
	const phType = getShapePlaceholderType(shape);
	if (phIdx === null && phType === null) return own;
	const theme = getPresentationTheme(pres);
	const layout = getSlideLayout(shape[SHAPE_SLIDE]);
	if (!layout) return own;
	const findPh = (shapes) => {
		let match = phIdx !== null ? shapes.find((s) => s.placeholderIdx === phIdx) : void 0;
		if (!match && phType !== null) match = shapes.find((s) => s.placeholderType === phType);
		return match?.element ?? null;
	};
	const readEffectsOn = (el) => {
		const spPr = firstChildElement(el, qname("p", "spPr", NS.pml));
		if (!spPr) return [];
		const eff = firstChildElement(spPr, qname("a", "effectLst", NS.dml));
		if (!eff) return [];
		return parseEffectLst(eff, theme);
	};
	const layoutPh = findPh(layout[LAYOUT_PART].shapes);
	if (layoutPh) {
		const layoutEffects = readEffectsOn(layoutPh);
		if (layoutEffects.length > 0) return layoutEffects;
	}
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return own;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return own;
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return own;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const { shapes: masterShapes } = readShapeTreeFromCsldRoot(masterRoot, "sldMaster");
	const masterPh = findPh(masterShapes);
	if (masterPh) {
		const masterEffects = readEffectsOn(masterPh);
		if (masterEffects.length > 0) return masterEffects;
	}
	return own;
};
/**
* Sets an outer drop shadow on the shape. Defaults: black, 4pt blur,
* 3pt offset, 45° (down-right). Pass `opacity` (0–1) to soften the
* shadow.
*/
const setShapeShadow = (shape, options = {}) => {
	setShadow(requireSpPr(shape), options);
	commitAndRefresh(shape);
};
/**
* Sets a glow around the shape. The radius is in EMU (default 5pt =
* 63500). Mutually exclusive with `setShapeShadow` in v1 — calling
* either replaces the prior `<a:effectLst>` entirely.
*/
const setShapeGlow = (shape, options) => {
	setGlow(requireSpPr(shape), options);
	commitAndRefresh(shape);
};
/** Removes any effects (shadow / glow / future presets) from the shape. */
const clearShapeEffects = (shape) => {
	clearEffects(requireSpPr(shape));
	commitAndRefresh(shape);
};
//#endregion
//#region src/api/fn/shape-text.ts
const NAME_TX_BODY = qname("p", "txBody", NS.pml);
/**
* Replaces the shape's visible text with `value`. Newlines start a new
* paragraph. Existing run/paragraph properties are preserved so font,
* color, size, alignment, and bullet style stay intact. The paragraph-end
* format (`<a:endParaRPr>`) is not kept; author it with `setShapeParagraphs`.
*/
const setShapeText = (shape, value, options = {}) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "shape") throw new Error(`setShapeText only works on text-bearing shapes; ${shape[SHAPE_SNAPSHOT].kind} is not one`);
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (txBody === null) throw new Error(`shape "${shape[SHAPE_SNAPSHOT].name}" has no <p:txBody>`);
	setTextBody(txBody, value, options.bullets);
	commitAndRefresh(shape);
};
/**
* Appends `value` to the shape's existing text on a new line. The
* shape's existing run / paragraph formatting is preserved by
* `setTextBody`; the new paragraph inherits the same template.
*
* Equivalent to `setShapeText(shape, getShapeText(shape) + '\n' + value)`,
* minus the leading newline when there was no existing text.
*/
const appendShapeText = (shape, value) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "shape") throw new Error(`appendShapeText only works on text-bearing shapes; ${shape[SHAPE_SNAPSHOT].kind} is not one`);
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (txBody === null) throw new Error(`shape "${shape[SHAPE_SNAPSHOT].name}" has no <p:txBody>`);
	const existing = shape[SHAPE_SNAPSHOT].text;
	setTextBody(txBody, existing.length === 0 ? value : `${existing}\n${value}`);
	commitAndRefresh(shape);
};
const NAME_A_BODY_PR = qname("a", "bodyPr", NS.dml);
const AUTO_FIT_LOCALS = new Set([
	"noAutofit",
	"normAutofit",
	"spAutoFit"
]);
const requireBodyPr = (shape) => {
	const txBody = requireTxBody(shape);
	let bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (bodyPr === null) {
		bodyPr = elem(NAME_A_BODY_PR);
		txBody.children.unshift(bodyPr);
	}
	return bodyPr;
};
/**
* Sets the text-body word-wrap mode.
*
*   - `'square'` writes `wrap="square"` — PowerPoint default for textboxes.
*   - `'none'`   writes `wrap="none"`  — text can overflow horizontally.
*
* Throws for non-text-bearing shape kinds.
*/
const setShapeTextWrap = (shape, wrap) => {
	oneOf(wrap, ["none", "square"], "setShapeTextWrap: wrap");
	const bodyPr = requireBodyPr(shape);
	const ATTR_WRAP = qname("", "wrap", "");
	bodyPr.attrs = bodyPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "wrap"));
	bodyPr.attrs.push(attr(ATTR_WRAP, wrap));
	commitAndRefresh(shape);
};
/** Reads back the bodyPr `wrap` attribute, or `null` when absent. */
const getShapeTextWrap = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (!txBody) return null;
	const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (!bodyPr) return null;
	const v = getAttrValue(bodyPr, qname("", "wrap", ""));
	if (v === "none" || v === "square") return v;
	return null;
};
/**
* Sets the text-body auto-fit mode:
*
*   - `'none'`   → `<a:noAutofit/>`
*   - `'normal'` → `<a:normAutofit/>`   shrink text to fit the shape
*   - `'shape'`  → `<a:spAutoFit/>`     grow the shape to fit text
*
* Replaces any prior auto-fit child on `<a:bodyPr>`. Throws for
* non-text-bearing shape kinds.
*/
const setShapeTextAutoFit = (shape, mode) => {
	oneOf(mode, [
		"none",
		"normal",
		"shape"
	], "setShapeTextAutoFit: mode");
	const bodyPr = requireBodyPr(shape);
	bodyPr.children = bodyPr.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.dml && AUTO_FIT_LOCALS.has(c.name.localName)));
	const local = {
		none: "noAutofit",
		normal: "normAutofit",
		shape: "spAutoFit"
	}[mode];
	bodyPr.children.push(elem(qname("a", local, NS.dml)));
	commitAndRefresh(shape);
};
/**
* Reads back the bodyPr auto-fit child, or `null` when none is
* present (PowerPoint applies a layout-inherited default in that case).
*/
const getShapeTextAutoFit = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (!txBody) return null;
	const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (!bodyPr) return null;
	for (const c of bodyPr.children) {
		if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
		if (c.name.localName === "noAutofit") return "none";
		if (c.name.localName === "normAutofit") return "normal";
		if (c.name.localName === "spAutoFit") return "shape";
	}
	return null;
};
/**
* Reads the scale parameters PowerPoint stores on `<a:normAutofit>`
* once it has shrunk a text body to fit. Returns `null` if the body
* doesn't carry `<a:normAutofit>` or the attributes are absent. Both
* fields are unitless ratios in `[0, 1]`:
*
*   - `fontScale`     — multiply every run's font size by this. Default `1`.
*   - `lnSpcReduction` — subtract from the line-height ratio. Default `0`.
*
* Companion to `getShapeTextAutoFit`. Renderers that want to match
* PowerPoint's actual on-screen text size apply these factors to the
* authored font sizes; without them, every long title overflows.
*/
const getShapeTextAutoFitParams = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (!txBody) return null;
	const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (!bodyPr) return null;
	for (const c of bodyPr.children) if (c.kind === "element" && c.name.namespaceURI === NS.dml && c.name.localName === "normAutofit") {
		const fsRaw = getAttrValue(c, qname("", "fontScale", ""));
		const lsRaw = getAttrValue(c, qname("", "lnSpcReduction", ""));
		const fs = fsRaw === null ? 1e5 : Number.parseInt(fsRaw, 10);
		const ls = lsRaw === null ? 0 : Number.parseInt(lsRaw, 10);
		return {
			fontScale: Number.isFinite(fs) ? fs / 1e5 : 1,
			lnSpcReduction: Number.isFinite(ls) ? ls / 1e5 : 0
		};
	}
	return null;
};
/**
* Reads back the vertical text anchor on the shape's `<a:bodyPr>`.
* Maps the ECMA-376 tokens back to the public union:
*
*   `'t'` → `'top'`, `'ctr'` → `'center'`, `'b'` → `'bottom'`
*
* Returns `null` when the bodyPr is absent or has no anchor attribute.
*/
const getShapeTextAnchor = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (!txBody) return null;
	const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (!bodyPr) return null;
	const v = getAttrValue(bodyPr, qname("", "anchor", ""));
	if (v === "t") return "top";
	if (v === "ctr") return "center";
	if (v === "b") return "bottom";
	return null;
};
/**
* Reads back the internal margins of the shape's text frame. Sides
* that are absent in the XML default to `null` (PowerPoint applies
* its built-in default for the missing side).
*/
/**
* Reads the multi-column layout on a text body — `<a:bodyPr
* numCol="N" spcCol="EMU"/>`. Returns `null` when columns aren't
* configured (the default single column). `gapEmu` is the
* inter-column gap in EMU; omitted when `<a:bodyPr>` has no
* `spcCol` attribute.
*/
const getShapeTextColumns = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (!txBody) return null;
	const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (!bodyPr) return null;
	const numColRaw = getAttrValue(bodyPr, qname("", "numCol", ""));
	if (numColRaw === null) return null;
	const count = Number.parseInt(numColRaw, 10);
	if (!Number.isFinite(count) || count < 2) return null;
	const gapRaw = getAttrValue(bodyPr, qname("", "spcCol", ""));
	if (gapRaw !== null) {
		const g = Number.parseInt(gapRaw, 10);
		if (Number.isFinite(g)) return {
			count,
			gapEmu: g
		};
	}
	return { count };
};
/**
* Sets the multi-column layout on the shape's text body — writes
* `<a:bodyPr numCol="N" [spcCol="EMU"]/>`. Pass `null` to clear both
* attributes so the text body falls back to PowerPoint's default
* single column. `count` must be in `2..16` (ST_TextColumnCount caps at
* 16, and single column is the `null` default). `gapEmu`, when omitted,
* removes any prior `spcCol`. Throws for non-text-bearing shape kinds.
*/
const setShapeTextColumns = (shape, columns) => {
	const bodyPr = requireBodyPr(shape);
	bodyPr.attrs = bodyPr.attrs.filter((a) => !(a.name.namespaceURI === "" && (a.name.localName === "numCol" || a.name.localName === "spcCol")));
	if (columns !== null) {
		if (columns.count < 2) throw new Error(`setShapeTextColumns: count must be >= 2 (single column is the default — pass null instead). Got ${columns.count}.`);
		const numCol = textColumnCount(columns.count, "setShapeTextColumns: count");
		bodyPr.attrs.push(attr(qname("", "numCol", ""), String(numCol)));
		if (columns.gapEmu !== void 0) {
			const spcCol = emuPositiveCoordinate32(columns.gapEmu, "setShapeTextColumns: gapEmu");
			bodyPr.attrs.push(attr(qname("", "spcCol", ""), String(spcCol)));
		}
	}
	commitAndRefresh(shape);
};
/**
* Reads the shape's text-body rotation from `<a:bodyPr rot="N"/>`.
* `rot` is stored in 60000ths of a degree (OOXML angle units); the
* returned value is in degrees. Positive values rotate clockwise per
* PowerPoint's convention. Returns `null` when the attribute is
* absent.
*
* Distinct from the shape's own `<p:xfrm rot=…>` (the geometry
* rotation surfaced via the shape's `rotation`); `bodyPr rot` rotates
* the text body inside the shape without rotating the shape itself.
*/
const getShapeTextBodyRotationDeg = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (!txBody) return null;
	const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (!bodyPr) return null;
	const v = getAttrValue(bodyPr, qname("", "rot", ""));
	if (v === null) return null;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? n / 6e4 : null;
};
/**
* Sets the shape's text-body rotation (`<a:bodyPr rot="N"/>`), measured
* in degrees. Positive rotates clockwise per PowerPoint's convention.
* Passing `null` clears the attribute so the shape inherits the default
* (`0`). Throws for non-text-bearing shape kinds.
*
* Companion to `setShapeRotation`, which rotates the *whole* shape
* via `<p:xfrm rot>`. `bodyPr rot` rotates only the text inside.
*/
const setShapeTextBodyRotationDeg = (shape, rotationDeg) => {
	const bodyPr = requireBodyPr(shape);
	bodyPr.attrs = bodyPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "rot"));
	if (rotationDeg !== null && rotationDeg !== 0) {
		const rot = angle60000(rotationDeg * 6e4, "setShapeTextBodyRotationDeg: rotationDeg");
		bodyPr.attrs.push(attr(qname("", "rot", ""), String(rot)));
	}
	commitAndRefresh(shape);
};
/**
* Reads the shape's text-direction token from `<a:bodyPr vert="…"/>`.
* Per ECMA-376 §17.18.93 `ST_TextVerticalType`:
*
*   - `horz` — default left-to-right, top-to-bottom (returns `null`).
*   - `vert` — 90° rotation, lines run top-to-bottom, columns right-to-left.
*   - `vert270` — 270° rotation, lines top-to-bottom, columns left-to-right.
*   - `wordArtVert` — characters not rotated, stacked vertically.
*   - `eaVert` — East-Asian vertical: characters upright, columns right-to-left.
*   - `mongolianVert` — Mongolian: rotated 90°, columns left-to-right.
*   - `wordArtVertRtl` — RTL word-art stacked vertically.
*
* Returns `null` when the attribute is absent or set to the default
* `horz`.
*/
const getShapeTextDirection = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (!txBody) return null;
	const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (!bodyPr) return null;
	const v = getAttrValue(bodyPr, qname("", "vert", ""));
	if (v === "vert" || v === "vert270" || v === "wordArtVert" || v === "eaVert" || v === "mongolianVert" || v === "wordArtVertRtl") return v;
	return null;
};
/**
* Sets the shape's text-direction via `<a:bodyPr vert="…"/>`. See
* `getShapeTextDirection` for the meaning of each value. Passing `null`
* (or `'horz'`) clears the attribute so the shape uses the default
* horizontal direction. Throws for non-text-bearing shape kinds.
*/
const setShapeTextDirection = (shape, direction) => {
	if (direction !== null) oneOf(direction, TEXT_DIRECTIONS, "setShapeTextDirection: direction");
	const bodyPr = requireBodyPr(shape);
	bodyPr.attrs = bodyPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "vert"));
	if (direction !== null && direction !== "horz") bodyPr.attrs.push(attr(qname("", "vert", ""), direction));
	commitAndRefresh(shape);
};
const getShapeTextMargins = (shape) => {
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (!txBody) return null;
	const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (!bodyPr) return null;
	const readSide = (local) => {
		const v = getAttrValue(bodyPr, qname("", local, ""));
		if (v === null) return null;
		const n = Number.parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	};
	return {
		left: readSide("lIns"),
		top: readSide("tIns"),
		right: readSide("rIns"),
		bottom: readSide("bIns")
	};
};
/**
* Resolves the effective `<a:bodyPr>` properties — anchor, wrap, vertical
* direction, and inset margins — by walking the layout / master cascade
* the same way `getShapeRunFormatEffective` walks rPr. Returns the
* innermost value that the cascade supplies, or `null` for properties
* neither the shape nor any inherited placeholder authors.
*
* Companion to `getShapeTextAnchor` / `getShapeTextWrap` /
* `getShapeTextDirection` / `getShapeTextMargins`, which only report the
* literal value on the shape itself.
*/
const getShapeBodyPrEffective = (pres, shape) => {
	const result = {
		anchor: null,
		wrap: null,
		vert: null,
		margins: {
			left: null,
			top: null,
			right: null,
			bottom: null
		}
	};
	const parseBodyPr = (bodyPr) => {
		if (result.anchor === null) {
			const a = getAttrValue(bodyPr, qname("", "anchor", ""));
			if (a === "t") result.anchor = "top";
			else if (a === "ctr") result.anchor = "center";
			else if (a === "b") result.anchor = "bottom";
		}
		if (result.wrap === null) {
			const w = getAttrValue(bodyPr, qname("", "wrap", ""));
			if (w === "square") result.wrap = "square";
			else if (w === "none") result.wrap = "none";
		}
		if (result.vert === null) {
			const v = getAttrValue(bodyPr, qname("", "vert", ""));
			if (v === "vert" || v === "vert270" || v === "wordArtVert" || v === "eaVert" || v === "mongolianVert" || v === "wordArtVertRtl") result.vert = v;
		}
		for (const side of [
			"l",
			"t",
			"r",
			"b"
		]) {
			const target = side === "l" ? "left" : side === "t" ? "top" : side === "r" ? "right" : "bottom";
			if (result.margins[target] !== null) continue;
			const v = getAttrValue(bodyPr, qname("", `${side}Ins`, ""));
			if (v === null) continue;
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n)) result.margins[target] = n;
		}
	};
	const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
	if (txBody) {
		const bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
		if (bodyPr) parseBodyPr(bodyPr);
	}
	const phIdx = getShapePlaceholderIdx(shape);
	const phType = getShapePlaceholderType(shape);
	const slide = shape[SHAPE_SLIDE];
	const layout = getSlideLayout(slide);
	if (!layout) return result;
	const findPh = (shapes) => matchPlaceholderShape(shapes, phIdx, phType)?.element ?? null;
	const layoutPhEl = findPh(layout[LAYOUT_PART].shapes);
	if (layoutPhEl) {
		const layoutTxBody = firstChildElement(layoutPhEl, NAME_TX_BODY);
		if (layoutTxBody) {
			const bodyPr = firstChildElement(layoutTxBody, NAME_A_BODY_PR);
			if (bodyPr) parseBodyPr(bodyPr);
		}
	}
	const pkg = pres[INTERNAL_PACKAGE];
	const layoutPartName = partName(layout[LAYOUT_PART_NAME]);
	const layoutRels = pkg.getRels(layoutPartName);
	if (!layoutRels) return result;
	const masterRel = layoutRels.items.find((r) => r.type === REL_TYPES.slideMaster);
	if (!masterRel) return result;
	const masterPart = pkg.getPart(resolveTarget(layoutPartName, masterRel.target));
	if (!masterPart) return result;
	const masterRoot = parseXml(decode$1(masterPart.data)).root;
	const { shapes: masterShapes } = readShapeTreeFromCsldRoot(masterRoot, "sldMaster");
	const masterPhEl = findPh(masterShapes);
	if (masterPhEl) {
		const masterTxBody = firstChildElement(masterPhEl, NAME_TX_BODY);
		if (masterTxBody) {
			const bodyPr = firstChildElement(masterTxBody, NAME_A_BODY_PR);
			if (bodyPr) parseBodyPr(bodyPr);
		}
	}
	return result;
};
const setShapeTextAnchor = (shape, anchor) => {
	oneOf(anchor, [
		"top",
		"center",
		"bottom"
	], "setShapeTextAnchor: anchor");
	const txBody = requireTxBody(shape);
	let bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (bodyPr === null) {
		bodyPr = elem(NAME_A_BODY_PR);
		txBody.children.unshift(bodyPr);
	}
	const token = TEXT_ANCHORS[anchor];
	const ATTR_ANCHOR = qname("", "anchor", "");
	bodyPr.attrs = bodyPr.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "anchor"));
	bodyPr.attrs.push(attr(ATTR_ANCHOR, token));
	commitAndRefresh(shape);
};
/**
* Sets the internal margins of the shape's text frame in EMU. Each
* side is independent; omitted sides keep their current value (or the
* layout-inherited default when the attribute is absent).
*
* PowerPoint's defaults for a textbox: left/right 91440 (0.1in),
* top/bottom 45720 (0.05in).
*
*   setShapeTextMargins(shape, { left: 0, right: 0 }); // flush-left text
*/
const setShapeTextMargins = (shape, margins) => {
	const txBody = requireTxBody(shape);
	let bodyPr = firstChildElement(txBody, NAME_A_BODY_PR);
	if (bodyPr === null) {
		bodyPr = elem(NAME_A_BODY_PR);
		txBody.children.unshift(bodyPr);
	}
	const writes = [];
	if (margins.left !== void 0) writes.push({
		name: "lIns",
		value: margins.left
	});
	if (margins.top !== void 0) writes.push({
		name: "tIns",
		value: margins.top
	});
	if (margins.right !== void 0) writes.push({
		name: "rIns",
		value: margins.right
	});
	if (margins.bottom !== void 0) writes.push({
		name: "bIns",
		value: margins.bottom
	});
	const localsToClear = new Set(writes.map((w) => w.name));
	bodyPr.attrs = bodyPr.attrs.filter((a) => !(a.name.namespaceURI === "" && localsToClear.has(a.name.localName)));
	for (const w of writes) {
		const emu = emuCoordinate32(w.value, `setShapeTextMargins: ${w.name}`);
		bodyPr.attrs.push(attr(qname("", w.name, ""), String(emu)));
	}
	commitAndRefresh(shape);
};
/** Sets the bullet style on every paragraph in the shape's text body. */
const setShapeBulletStyle = (shape, style) => {
	applyBulletToAllParagraphs(requireTxBody(shape), style);
	commitAndRefresh(shape);
};
/** Sets the horizontal alignment of every paragraph in the shape's text. */
const setShapeAlignment = (shape, align) => {
	applyAlignmentToAllParagraphs(requireTxBody(shape), align);
	commitAndRefresh(shape);
};
/**
* Applies `format` to every run in the shape's text. Run-property
* attributes not addressed by `format` are preserved, so partial
* updates compose.
*/
const setShapeTextFormat = (shape, format) => {
	applyFormatToAllRuns(requireTxBody(shape), format, "setShapeTextFormat");
	commitAndRefresh(shape);
};
/**
* Replaces the shape's text with explicitly structured paragraphs, each
* carrying its own runs and per-run formats. `setShapeText` yields one run
* per paragraph; use this when a paragraph mixes formats (a bold lead-in
* followed by plain text, for example). Read back with
* `getShapeParagraphElements`.
*/
const setShapeParagraphs = (shape, paragraphs) => {
	setTextBodyParagraphs(requireTxBody(shape), paragraphs);
	commitAndRefresh(shape);
};
//#endregion
//#region src/api/fn/shape-removal-zorder.ts
/**
* Copies a shape into `targetSlide`. The source XML is cloned and
* appended to the target's `<p:spTree>`. Image rels on the source
* shape are followed: the linked media part is referenced from the
* target slide via a freshly allocated rId (no media bytes are
* copied — both slides share the underlying part).
*
* v1 requires source and target to live in the same package
* (`sourceShape`'s slide and `targetSlide` must share the same
* `OpcPackage`). Cross-package copy is `importSlide` territory.
*
* Returns the new `SlideShapeData` on `targetSlide`.
*/
const copyShape = (targetSlide, sourceShape) => {
	const sourceSlide = sourceShape[SHAPE_SLIDE];
	if (sourceSlide[INTERNAL_PACKAGE] !== targetSlide[INTERNAL_PACKAGE]) throw new Error("copyShape: source and target must be in the same package. Use importSlide for cross-deck copies.");
	const pkg = targetSlide[INTERNAL_PACKAGE];
	const sourceEl = sourceShape[SHAPE_ELEMENT];
	const cloned = cloneXmlElement(sourceEl);
	const newId = nextShapeId(targetSlide);
	rewriteCNvPrId(cloned, newId);
	const sourceRels = pkg.getRels(sourceSlide[SLIDE_PART_NAME]);
	if (sourceRels) {
		const targetRels = pkg.getRels(targetSlide[SLIDE_PART_NAME]) ?? emptyRels();
		const usedIds = new Set(targetRels.items.map((r) => r.id));
		rewriteRIdReferences(cloned, (oldRId) => {
			const sourceRel = sourceRels.items.find((r) => r.id === oldRId);
			if (!sourceRel) return oldRId;
			const existing = targetRels.items.find((r) => r.type === sourceRel.type && r.target === sourceRel.target && r.targetMode === sourceRel.targetMode);
			if (existing) return existing.id;
			const newRId = nextRelId([...usedIds]);
			usedIds.add(newRId);
			targetRels.items.push({
				...sourceRel,
				id: newRId
			});
			return newRId;
		});
		pkg.setRels(targetSlide[SLIDE_PART_NAME], targetRels);
	}
	const media = cloned.name.localName === "pic" ? readPictureMediaRef(cloned) : null;
	if (media !== null) addMediaTimingNode(targetSlide, media.kind, newId);
	return appendAndReturnNewShape(targetSlide, cloned);
};
/** Recursively clone an XML element (no parent, deep). */
const cloneXmlElement = (el) => ({
	kind: "element",
	name: el.name,
	attrs: el.attrs.map((a) => ({
		name: a.name,
		value: a.value
	})),
	prefixDecls: new Map(el.prefixDecls),
	children: el.children.map((c) => {
		if (c.kind === "element") return cloneXmlElement(c);
		return { ...c };
	})
});
const rewriteCNvPrId = (root, newId) => {
	const walk = (el) => {
		if (el.name.namespaceURI === NS.pml && el.name.localName === "cNvPr" && el.attrs.some((a) => a.name.namespaceURI === "" && a.name.localName === "id")) {
			el.attrs = el.attrs.map((a) => a.name.namespaceURI === "" && a.name.localName === "id" ? {
				name: a.name,
				value: String(newId)
			} : a);
			return true;
		}
		for (const c of el.children) if (c.kind === "element" && walk(c)) return true;
		return false;
	};
	walk(root);
};
const rewriteRIdReferences = (root, map) => {
	const walk = (el) => {
		el.attrs = el.attrs.map((a) => {
			if (a.name.namespaceURI === NS.officeDocRels && (a.name.localName === "id" || a.name.localName === "embed" || a.name.localName === "link")) return {
				name: a.name,
				value: map(a.value)
			};
			return a;
		});
		for (const c of el.children) if (c.kind === "element") walk(c);
	};
	walk(root);
};
const SHAPE_CHILD_LOCALS = new Set([
	"sp",
	"pic",
	"cxnSp",
	"graphicFrame",
	"grpSp"
]);
const isShapeChild = (node) => node.kind === "element" && node.name?.namespaceURI === NS.pml && SHAPE_CHILD_LOCALS.has(node.name.localName);
/** Move `shape` to the end of its spTree (render in front of all others). */
const bringShapeToFront = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const spTree = requireSpTree(slide);
	const target = shape[SHAPE_ELEMENT];
	const idx = spTree.children.indexOf(target);
	if (idx < 0) return;
	if (idx === spTree.children.length - 1) return;
	spTree.children.splice(idx, 1);
	spTree.children.push(target);
	commitSlideData(slide);
	rebuildShapesFromDocument(slide);
};
/**
* Move `shape` behind every other shape on the slide. The
* `<p:nvGrpSpPr>` / `<p:grpSpPr>` preface — required by the schema —
* stays at the top.
*/
const sendShapeToBack = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const spTree = requireSpTree(slide);
	const target = shape[SHAPE_ELEMENT];
	const idx = spTree.children.indexOf(target);
	if (idx < 0) return;
	let firstShapeAt = spTree.children.length;
	for (let i = 0; i < spTree.children.length; i++) {
		const c = spTree.children[i];
		if (c && isShapeChild(c)) {
			firstShapeAt = i;
			break;
		}
	}
	if (idx <= firstShapeAt) return;
	spTree.children.splice(idx, 1);
	spTree.children.splice(firstShapeAt, 0, target);
	commitSlideData(slide);
	rebuildShapesFromDocument(slide);
};
/** Swap `shape` with the next shape sibling (move one step forward). */
const bringShapeForward = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const spTree = requireSpTree(slide);
	const target = shape[SHAPE_ELEMENT];
	const idx = spTree.children.indexOf(target);
	if (idx < 0) return;
	for (let i = idx + 1; i < spTree.children.length; i++) {
		const c = spTree.children[i];
		if (c && isShapeChild(c)) {
			const next = c;
			spTree.children[idx] = next;
			spTree.children[i] = target;
			commitSlideData(slide);
			rebuildShapesFromDocument(slide);
			return;
		}
	}
};
/**
* Returns the shape's z-index among the slide's "real" shape children
* (`<p:sp>` / `<p:pic>` / `<p:cxnSp>` / `<p:graphicFrame>` / `<p:grpSp>`),
* skipping the required `<p:nvGrpSpPr>` / `<p:grpSpPr>` preface.
* Higher numbers render in front.
*/
const getShapeZIndex = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const spTree = requireSpTree(slide);
	let i = 0;
	for (const c of spTree.children) {
		if (!isShapeChild(c)) continue;
		if (c === shape[SHAPE_ELEMENT]) return i;
		i++;
	}
	return -1;
};
/**
* Moves the shape to a specific z-index among the slide's "real"
* shape children. Index is clamped to the available range. Higher
* numbers render in front. The required preface elements stay at the
* top of `<p:spTree>`.
*/
const setShapeZIndex = (shape, toIndex) => {
	const slide = shape[SHAPE_SLIDE];
	const spTree = requireSpTree(slide);
	const target = shape[SHAPE_ELEMENT];
	const allShapeChildren = spTree.children.filter((c) => isShapeChild(c));
	const clamped = Math.max(0, Math.min(toIndex, allShapeChildren.length - 1));
	spTree.children = spTree.children.filter((c) => c !== target);
	const remainingShapes = spTree.children.filter((c) => isShapeChild(c));
	if (clamped >= remainingShapes.length) spTree.children.push(target);
	else {
		const anchor = remainingShapes[clamped];
		const anchorIdx = spTree.children.indexOf(anchor);
		spTree.children.splice(anchorIdx, 0, target);
	}
	commitSlideData(slide);
	rebuildShapesFromDocument(slide);
};
/** Swap `shape` with the previous shape sibling (move one step backward). */
const sendShapeBackward = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const spTree = requireSpTree(slide);
	const target = shape[SHAPE_ELEMENT];
	const idx = spTree.children.indexOf(target);
	if (idx < 0) return;
	for (let i = idx - 1; i >= 0; i--) {
		const c = spTree.children[i];
		if (c && isShapeChild(c)) {
			const prev = c;
			spTree.children[idx] = prev;
			spTree.children[i] = target;
			commitSlideData(slide);
			rebuildShapesFromDocument(slide);
			return;
		}
	}
};
/**
* Removes the shape from its slide's shape tree. Subsequent property
* reads on this handle reflect the stale snapshot — discard it after.
*
* Removing a picture does NOT delete the underlying media part — it
* may be referenced from other slides.
*/
/**
* Removes every shape (sp / pic / cxnSp / graphicFrame / grpSp) from
* the slide's `<p:spTree>`. The required `<p:nvGrpSpPr>` and
* `<p:grpSpPr>` preface stays in place, so the slide is still valid
* and re-applies its layout's placeholders on the next open.
*
* Useful for "start this slide over but keep its layout binding."
*/
const clearSlideShapes = (slide) => {
	const spTree = requireSpTree(slide);
	const removedIds = /* @__PURE__ */ new Set();
	spTree.children = spTree.children.filter((c) => {
		const isShape = c.kind === "element" && c.name.namespaceURI === NS.pml && SHAPE_CHILD_LOCALS.has(c.name.localName);
		if (isShape) collectShapeIds(c, removedIds);
		return !isShape;
	});
	removeMediaTimingNodes(slide, removedIds);
	commitSlideData(slide);
	rebuildShapesFromDocument(slide);
};
const removeShape = (shape) => {
	const slide = shape[SHAPE_SLIDE];
	const doc = slide[SLIDE_DOCUMENT];
	const cSld = firstChildElement(doc.root, qname("p", "cSld", NS.pml));
	if (!cSld) return;
	const spTree = firstChildElement(cSld, qname("p", "spTree", NS.pml));
	if (!spTree) return;
	const idx = spTree.children.indexOf(shape[SHAPE_ELEMENT]);
	if (idx < 0) return;
	spTree.children.splice(idx, 1);
	const removedIds = /* @__PURE__ */ new Set();
	collectShapeIds(shape[SHAPE_ELEMENT], removedIds);
	removeMediaTimingNodes(slide, removedIds);
	commitSlideData(slide);
	rebuildShapesFromDocument(slide);
};
const collectShapeIds = (el, into) => {
	if (el.name.namespaceURI === NS.pml && el.name.localName === "cNvPr") {
		const id = Number.parseInt(getAttrValue(el, qname("", "id", "")) ?? "", 10);
		if (Number.isFinite(id)) into.add(id);
		return;
	}
	for (const c of el.children) if (c.kind === "element") collectShapeIds(c, into);
};
//#endregion
//#region src/api/fn/shape-authoring.ts
/**
* Adds a free-form text box to the slide. Returns the new shape.
*
* The box is a plain rectangle with no fill or outline carrying one
* paragraph with one run. The shape id is allocated as one more than
* the current max id.
*/
const addSlideTextBox = (slide, opts) => {
	return appendAndReturnNewShape(slide, buildTextBox({
		id: nextShapeId(slide),
		...opts.name !== void 0 ? { name: opts.name } : {},
		x: opts.x,
		y: opts.y,
		w: opts.w,
		h: opts.h,
		text: opts.text
	}));
};
/**
* Adds a preset shape (rectangle, ellipse, arrow, ...) to the slide.
* Optional `text` seeds a single run.
*/
const addSlideShape = (slide, opts) => {
	return appendAndReturnNewShape(slide, buildShape({
		id: nextShapeId(slide),
		...opts.name !== void 0 ? { name: opts.name } : {},
		preset: opts.preset,
		x: opts.x,
		y: opts.y,
		w: opts.w,
		h: opts.h,
		...opts.text !== void 0 ? { text: opts.text } : {},
		...opts.textAnchor !== void 0 ? { textAnchor: opts.textAnchor } : {}
	}));
};
/** Adds a straight-line connector between two points. */
const addSlideLine = (slide, opts) => {
	return appendAndReturnNewShape(slide, buildConnector({
		id: nextShapeId(slide),
		...opts.name !== void 0 ? { name: opts.name } : {},
		from: opts.from,
		to: opts.to,
		...opts.color !== void 0 ? { color: opts.color } : {},
		...opts.widthEmu !== void 0 ? { widthEmu: opts.widthEmu } : {}
	}));
};
/**
* Adds a table to the slide. Cells render as plain text; `firstRow` /
* `bandRow` flags drive PowerPoint's banded-header look unless options say
* otherwise.
*
* Cell text color is baked from the deck's resolved body-text color so the
* table stays readable even on templates with an inverted color map
* (`bg1="dk1" tx1="lt1"`), where the default `tx1` text token would otherwise
* paint the text the same as the background. Override per cell afterwards with
* `setTableCellTextFormat`.
*/
const addSlideTable = (slide, opts) => {
	const textColorHex = resolveDeckBodyTextColor(slide);
	return appendAndReturnNewShape(slide, buildTable({
		id: nextShapeId(slide),
		...opts.name !== void 0 ? { name: opts.name } : {},
		x: opts.x,
		y: opts.y,
		w: opts.w,
		h: opts.h,
		rows: opts.rows,
		...opts.colWidths !== void 0 ? { colWidths: opts.colWidths } : {},
		...opts.rowHeights !== void 0 ? { rowHeights: opts.rowHeights } : {},
		...opts.firstRow !== void 0 ? { firstRow: opts.firstRow } : {},
		...opts.bandRow !== void 0 ? { bandRow: opts.bandRow } : {},
		...textColorHex !== null ? { textColorHex } : {}
	}));
};
/**
* Adds a picture to the slide from raw bytes. Returns the new shape.
*
* Allocates a `/ppt/media/imageN.<ext>` part, registers a Content_Types
* Default if the extension isn't yet covered, allocates a slide→image
* rel, and appends a `<p:pic>` element to the slide's `<p:spTree>`.
*
* Format is detected from magic bytes; pass `opts.format` to override.
*
* `opts.fit` controls how the image fills the `w × h` box. `'fill'` (the
* default) stretches to the exact box, ignoring aspect ratio. `'contain'`
* scales the image to fit inside the box preserving its aspect ratio and
* centers it — measured from the PNG / JPEG header. For other formats (or
* an unreadable header) `'contain'` falls back to `'fill'` rather than
* erroring, since the natural size is unknown.
*/
const addSlideImage = (slide, bytes, opts) => {
	const pkg = slide[INTERNAL_PACKAGE];
	const format = opts.format ?? detectImageFormat(bytes);
	if (format === null) throw new Error("addSlideImage: could not detect image format. Pass options.format explicitly.");
	const contentType = contentTypeForFormat(format);
	const extension = extensionForFormat(format);
	let nextN = 1;
	const mediaPattern = /^\/ppt\/media\/image(\d+)\./;
	for (const p of pkg.parts) {
		const m = p.name.match(mediaPattern);
		if (m?.[1] !== void 0) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n) && n >= nextN) nextN = n + 1;
		}
	}
	const newMediaName = partName(`/ppt/media/image${nextN}.${extension}`);
	if (!pkg.contentTypes.defaults.some((d) => d.extension.toLowerCase() === extension)) pkg.contentTypes.defaults.push({
		extension,
		contentType
	});
	pkg.addPart(newMediaName, contentType, bytes);
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
	const newRId = nextRelId(rels.items.map((r) => r.id));
	rels.items.push({
		id: newRId,
		type: REL_TYPES.image,
		target: `../media/image${nextN}.${extension}`,
		targetMode: "Internal"
	});
	pkg.setRels(slide[SLIDE_PART_NAME], rels);
	const rect = fitImageRect({
		x: opts.x,
		y: opts.y,
		w: opts.w,
		h: opts.h
	}, opts.fit ?? "fill", readImagePixelSize(bytes));
	return appendAndReturnNewShape(slide, buildPicture({
		id: nextShapeId(slide),
		...opts.name !== void 0 ? { name: opts.name } : {},
		rEmbed: newRId,
		x: rect.x,
		y: rect.y,
		w: rect.w,
		h: rect.h
	}));
};
//#endregion
//#region src/api/fn/slide-query.ts
const buildSlideData = (pkg, partNameValue, bytes) => {
	const doc = parseXml(decode$1(bytes));
	const part = readSlidePart(doc.root);
	const shapes = [];
	const slide = {
		[INTERNAL_PACKAGE]: pkg,
		[SLIDE_PART_NAME]: partNameValue,
		[SLIDE_DOCUMENT]: doc,
		[SLIDE_PART]: part,
		[SLIDE_SHAPES]: shapes
	};
	for (const snap of part.shapes) shapes.push({
		[SHAPE_SLIDE]: slide,
		[SHAPE_ELEMENT]: snap.element,
		[SHAPE_SNAPSHOT]: snap
	});
	return slide;
};
/**
* Enumerates slides in presentation order. Returns opaque `SlideData`
* handles that pass to every slide-level fn-API helper.
*
* Throws if any referenced slide part is missing — a structurally
* invalid PPTX cannot honor the L1 contract.
*/
/**
* Returns the shape at the given 0-based `index` on the slide, or
* `null` when `index` is out of range. Convenience over
* `getSlideShapes(slide)[index] ?? null`.
*/
const getShapeAt = (slide, index) => slide[SLIDE_SHAPES][index] ?? null;
/**
* Returns the slide count without forcing every slide part to be
* parsed. Reads only `presentation.xml` and walks `<p:sldIdLst>`.
*
* Equivalent to `getSlides(pres).length`, but cheaper on cold reads
* — useful when the caller only wants a count for UI badges or
* validation logic.
*/
const getSlideCount = (pres) => {
	const cached = pres._slidesCache;
	if (cached !== null) return cached.length;
	const presPart = pres[INTERNAL_PACKAGE].getPart(PRES_PART_NAME);
	if (!presPart) return 0;
	const root = parseXml(decode$1(presPart.data)).root;
	return readPresentationPart(root).slides.length;
};
/**
* Returns the number of slide layouts in the package. Walks the
* content-type map; cheaper than `getSlideLayouts(pres).length`
* because it avoids parsing each layout's XML body.
*/
const getSlideLayoutCount = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	let n = 0;
	for (const part of pkg.parts) if (part.contentType === "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml") n++;
	return n;
};
const getSlides = (pres) => {
	const cached = pres._slidesCache;
	if (cached !== null) return cached;
	const pkg = pres[INTERNAL_PACKAGE];
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (presPart === null) {
		const empty = [];
		pres._slidesCache = empty;
		return empty;
	}
	const presRels = pkg.getRels(PRES_PART_NAME);
	if (presRels === null) {
		const empty = [];
		pres._slidesCache = empty;
		return empty;
	}
	const presRoot = parseXml(decode$1(presPart.data)).root;
	const presModel = readPresentationPart(presRoot);
	const out = [];
	const relsById = new Map(presRels.items.map((rel) => [rel.id, rel]));
	for (const sld of presModel.slides) {
		const rel = relsById.get(sld.rId);
		if (!rel) throw new Error(`presentation.xml.rels missing entry for ${sld.rId}`);
		const target = rel.target;
		const slideName = partName(target.startsWith("/") ? target : `/ppt/${target}`);
		const slidePart = pkg.getPart(slideName);
		if (slidePart === null) throw new Error(`slide part ${slideName} not found`);
		out.push(buildSlideData(pkg, slideName, slidePart.data));
	}
	pres._slidesCache = out;
	return out;
};
/**
* Concatenated visible text of a slide. Convenience wrapper that walks
* the slide's shape tree without instantiating any class.
*/
const getSlideText = (slide) => slideText(slide[SLIDE_PART]);
/**
* Length (in code points) of the slide's concatenated visible text.
* Counts Unicode code points via `Array.from`, so surrogate-pair
* characters (emoji, supplementary CJK) count as 1, matching the
* library's invariant on text editing.
*/
const getSlideTextLength = (slide) => Array.from(getSlideText(slide)).length;
/**
* Returns a one-entry-per-slide outline: title + body-placeholder
* text. Useful for building thumbnail panes, table-of-contents
* inserts, or quick-look previews without rendering the slide.
*
* "Body" here is the first matching `body` placeholder per
* `findSlidePlaceholder(slide, 'body')`. Non-placeholder text on
* the slide isn't surfaced; use `getSlideText(slide)` for that.
*/
const getSlideOutline = (pres) => {
	const out = [];
	const slides = getSlides(pres);
	for (let i = 0; i < slides.length; i++) {
		const slide = slides[i];
		const body = findSlidePlaceholder(slide, "body");
		out.push({
			index: i,
			title: getSlideTitle(slide),
			body: body !== null ? body[SHAPE_SNAPSHOT].text : null
		});
	}
	return out;
};
/**
* Concatenated title + body text from every slide, joined with the
* given `separator` (defaults to `'\n\n'`). Useful for generating
* a table-of-contents handout from a deck. Slides without a title
* still contribute their body (and vice versa); slides without
* both are skipped.
*/
const getOutlineText = (pres, separator = "\n\n") => {
	const parts = [];
	for (const entry of getSlideOutline(pres)) {
		const segments = [];
		if (entry.title !== null) segments.push(entry.title);
		if (entry.body !== null) segments.push(entry.body);
		if (segments.length > 0) parts.push(segments.join("\n"));
	}
	return parts.join(separator);
};
/**
* Concatenated visible text from every slide, joined with the
* given `separator` (defaults to a form-feed, `\f`, between slides).
* Useful for search-indexing a whole deck without iterating slides
* yourself.
*/
const getPresentationText = (pres, separator = "\f") => {
	const parts = [];
	for (const slide of getSlides(pres)) parts.push(slideText(slide[SLIDE_PART]));
	return parts.join(separator);
};
/**
* Total code-point length of visible text across every slide.
* Sibling of `getSlideTextLength`; counts surrogate-pair characters
* (emoji, supplementary CJK) as 1 each. Cheaper than building the
* concatenated string when only the length matters.
*/
const getPresentationTextLength = (pres) => {
	let n = 0;
	for (const slide of getSlides(pres)) n += Array.from(slideText(slide[SLIDE_PART])).length;
	return n;
};
/**
* Dense per-slide shape count array, 0-based by slide index. Counts
* top-level + group-children shapes (whatever `getSlideShapes` flattens).
* Useful for charting shape density per slide and identifying outliers
* (the 200-shape "soup" slide everybody complains about) for cleanup.
*/
const getPresentationShapeCountsBySlide = (pres) => getSlides(pres).map((s) => s[SLIDE_SHAPES].length);
/**
* Dense per-slide visible-text length array, 0-based by slide index.
* Counts code points (surrogate pairs as 1) per `getSlideTextLength`.
* Pair with `getPresentationShapeCountsBySlide` for slide-density
* audits — high text length on a slide with few shapes usually means
* one paragraph-heavy text box; low text on a many-shape slide
* usually means a busy diagram.
*/
const getPresentationTextLengthsBySlide = (pres) => getSlides(pres).map((s) => Array.from(slideText(s[SLIDE_PART])).length);
/**
* Returns the 0-based index of `slide` within `pres`, or `-1` if the
* slide doesn't belong to this presentation (e.g. after a removeSlide
* call, or if it was constructed from a different package).
*/
const getSlideIndex = (pres, slide) => {
	return getSlides(pres).indexOf(slide);
};
/**
* Returns the slide at the given 0-based `index`, or `null` if `index`
* is out of range. Convenience over `getSlides(pres)[index] ?? null`.
*/
const getSlideAt = (pres, index) => {
	return getSlides(pres)[index] ?? null;
};
const getSlideInfo = (pres, slide) => {
	const layout = getSlideLayout(slide);
	return {
		index: getSlideIndex(pres, slide),
		title: getSlideTitle(slide),
		hidden: isSlideHidden(slide),
		shapeCount: getSlideShapes(slide).length,
		layoutName: layout ? layout[LAYOUT_PART].name : null
	};
};
/**
* Returns every slide bound to the given `layout`. Useful for "find
* all slides using the `Title and Content` layout" workflows; pair
* with `findSlideLayout(pres, name)` to look up the layout by name.
*/
const getSlidesByLayout = (pres, layout) => {
	const target = layout[LAYOUT_PART_NAME];
	const out = [];
	for (const slide of getSlides(pres)) {
		const found = getSlideLayout(slide);
		if (found !== null && found[LAYOUT_PART_NAME] === target) out.push(slide);
	}
	return out;
};
/**
* Returns the first slide whose title-placeholder text equals
* `title` exactly. Returns `null` when no slide matches. Different
* from `findSlideByText`, which matches any visible text — this one
* is title-placeholder-scoped. Accepts a literal string (exact
* equality) or a `RegExp` for pattern matches.
*/
const findSlideByTitle = (pres, title) => {
	for (const slide of getSlides(pres)) {
		const t = getSlideTitle(slide);
		if (t === null) continue;
		if (typeof title === "string" ? t === title : title.test(t)) return slide;
	}
	return null;
};
/**
* Returns the slide whose package part name equals `partName`
* (typically `/ppt/slides/slideN.xml`), or `null` when no such
* slide exists. Useful for callers that walk validator output,
* `listPackageParts`, or any other low-level path-keyed API and
* need the matching `SlideData` handle.
*/
const findSlideByPartName = (pres, partName) => {
	for (const slide of getSlides(pres)) if (slide[SLIDE_PART_NAME] === partName) return slide;
	return null;
};
/**
* Returns the package part name (e.g. `/ppt/slides/slide3.xml`) of
* `slide`. Useful for surfacing slides in validator output, error
* messages, or any path-keyed sidebar UI.
*/
const getSlidePartName = (slide) => slide[SLIDE_PART_NAME];
/**
* Returns the slide's current XML body as a string. Re-serializes
* from the typed AST, so this reflects any pending edits that
* haven't been written back to the package yet.
*
* Intended for diagnostics: dumping into bug reports, asserting
* structure in tests, snapshotting before / after a transformation.
* Do NOT parse this back yourself — round-trip safely through
* `loadPresentation` / `savePresentation`.
*/
const getSlideXmlString = (slide) => serializeXml(slide[SLIDE_DOCUMENT]);
/**
* Returns the first slide whose concatenated visible text contains
* `needle` (substring; case-sensitive). Pass a `RegExp` to test
* against the slide's text body instead. Returns `null` when no
* slide matches.
*/
const findSlideByText = (pres, needle) => {
	for (const slide of getSlides(pres)) {
		const text = slideText(slide[SLIDE_PART]);
		if (typeof needle === "string" ? text.includes(needle) : needle.test(text)) return slide;
	}
	return null;
};
/**
* Every slide whose concatenated visible text contains `needle`
* (substring) or matches the given `RegExp`.
*/
const findSlidesByText = (pres, needle) => {
	const out = [];
	for (const slide of getSlides(pres)) {
		const text = slideText(slide[SLIDE_PART]);
		if (typeof needle === "string" ? text.includes(needle) : needle.test(text)) out.push(slide);
	}
	return out;
};
/**
* Every slide whose speaker notes contain `needle` (substring) or
* match the given `RegExp`. Sibling of `findSlidesByText` — useful
* for surfacing reviewer-facing annotations stored in notes (e.g.
* "every slide whose notes say TODO").
*
* Slides without notes are skipped.
*/
const findSlidesByNotes = (pres, needle) => {
	const out = [];
	for (const slide of getSlides(pres)) {
		const notes = getSlideNotes(slide);
		if (notes === null || notes.length === 0) continue;
		if (typeof needle === "string" ? notes.includes(needle) : needle.test(notes)) out.push(slide);
	}
	return out;
};
/**
* Returns every slide where `needle` appears in **either** the
* visible text or the speaker notes. Each slide is reported once,
* in document order. Sibling of `findSlidesByText` /
* `findSlidesByNotes` — useful for a generic "search the deck"
* UX where the caller doesn't care which surface matched.
*/
const searchSlides = (pres, needle) => {
	const matchesString = (haystack) => typeof needle === "string" ? haystack.includes(needle) : needle.test(haystack);
	const out = [];
	for (const slide of getSlides(pres)) {
		if (matchesString(slideText(slide[SLIDE_PART]))) {
			out.push(slide);
			continue;
		}
		const notes = getSlideNotes(slide);
		if (notes !== null && notes.length > 0 && matchesString(notes)) out.push(slide);
	}
	return out;
};
/**
* Replaces every occurrence of `from` in every slide's speaker
* notes with `to`. Returns the number of slides updated. Sibling
* of `replaceTextInPresentation` for the reviewer-annotation pass.
*
* Slides without notes are skipped. For string needles, replacement
* is global; for RegExp needles, the global flag is forced.
*/
const replaceTextInNotes = (pres, from, to) => {
	let n = 0;
	for (const slide of getSlides(pres)) if (replaceTextInSlideNotes(slide, from, to)) n++;
	return n;
};
/**
* Slide-scoped sibling of `replaceTextInNotes`. Replaces every
* occurrence of `from` in the slide's speaker notes with `to`.
* Returns `true` if the notes changed, `false` otherwise (no notes
* present, or no match).
*/
const replaceTextInSlideNotes = (slide, from, to) => {
	const notes = getSlideNotes(slide);
	if (notes === null || notes.length === 0) return false;
	let next;
	if (typeof from === "string") {
		if (!notes.includes(from)) return false;
		next = notes.split(from).join(to);
	} else {
		const re = from.global ? from : new RegExp(from.source, `${from.flags}g`);
		if (!re.test(notes)) return false;
		re.lastIndex = 0;
		next = notes.replace(re, to);
	}
	if (next === notes) return false;
	setSlideNotes(slide, next);
	return true;
};
const getAllShapes = (pres) => {
	const out = [];
	const slides = getSlides(pres);
	for (let i = 0; i < slides.length; i++) {
		const slide = slides[i];
		for (const shape of getSlideShapes(slide)) out.push({
			slide,
			slideIndex: i,
			shape
		});
	}
	return out;
};
const ATTR_SHOW = qname("", "show", "");
/**
* Returns `true` when the slide carries `show="0"` on its root
* `<p:sld>` element. PowerPoint hides such slides from the slideshow
* but keeps them in the editing surface.
*/
const isSlideHidden = (slide) => {
	return getAttrValue(slide[SLIDE_DOCUMENT].root, ATTR_SHOW) === "0";
};
/**
* Returns `true` when the slide carries a `<p:timing>` block — i.e.,
* has at least one authored animation effect. Per-slide complement to
* `getPresentationSummary().hasAnimations`, which only reports a
* deck-wide flag.
*/
const slideHasAnimations = (slide) => {
	return slide[SLIDE_DOCUMENT].root.children.some((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "timing");
};
/**
* Toggles the slide's visibility in the slideshow. Hiding adds
* `show="0"`; showing removes the attribute (PowerPoint treats absence
* as the default `show="1"`).
*/
const setSlideHidden = (slide, hidden) => {
	const root = slide[SLIDE_DOCUMENT].root;
	root.attrs = root.attrs.filter((a) => !(a.name.namespaceURI === "" && a.name.localName === "show"));
	if (hidden) root.attrs.push(attr(ATTR_SHOW, "0"));
	commitSlideData(slide);
};
/**
* Replaces `{{key}}` tokens on every slide. Returns the total number of
* substitutions performed.
*/
const replaceTokensInPresentation = (pres, tokens) => {
	const pkg = pres[INTERNAL_PACKAGE];
	let count = 0;
	for (const part of pkg.parts) {
		if (part.contentType !== "application/vnd.openxmlformats-officedocument.presentationml.slide+xml") continue;
		const doc = parseXml(decode$1(part.data));
		const n = replaceTokensInTree(doc.root, tokens);
		if (n > 0) {
			part.data = encode$1(serializeXml(doc));
			count += n;
		}
	}
	pres._slidesCache = null;
	return count;
};
/**
* Replaces every occurrence of `from` in every slide's text with `to`.
* `from` may be a string (treated as a literal) or a `RegExp`. Returns
* the number of `<a:t>` elements mutated across the whole deck.
*
* Use this for the broad "rename product X to Y" pattern; for
* `{{token}}` style substitutions, prefer
* `replaceTokensInPresentation` which is more explicit about intent.
*/
const replaceTextInPresentation = (pres, from, to) => {
	const pkg = pres[INTERNAL_PACKAGE];
	let count = 0;
	for (const part of pkg.parts) {
		if (part.contentType !== "application/vnd.openxmlformats-officedocument.presentationml.slide+xml") continue;
		const doc = parseXml(decode$1(part.data));
		const n = replaceTextInTree(doc.root, from, to);
		if (n > 0) {
			part.data = encode$1(serializeXml(doc));
			count += n;
		}
	}
	pres._slidesCache = null;
	return count;
};
/**
* Replaces every occurrence of `from` in the slide's text with `to`.
* Returns the number of `<a:t>` elements mutated on this slide.
*/
const replaceTextInSlide = (slide, from, to) => {
	const n = replaceTextInTree(slide[SLIDE_DOCUMENT].root, from, to);
	if (n > 0) {
		commitSlideData(slide);
		refreshSlideData(slide);
	}
	return n;
};
//#endregion
//#region src/api/fn/sections.ts
const NS_P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const SECTION_LST_EXT_URI = "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}";
const NAME_EXT_LST = qname("p", "extLst", NS.pml);
const NAME_P_EXT = qname("p", "ext", NS.pml);
const NAME_P14_SECTION_LST = qname("p14", "sectionLst", NS_P14);
const NAME_P14_SECTION = qname("p14", "section", NS_P14);
const NAME_P14_SLD_ID_LST = qname("p14", "sldIdLst", NS_P14);
const NAME_P14_SLD_ID = qname("p14", "sldId", NS_P14);
const ATTR_URI = qname("", "uri", "");
const ATTR_NAME_SEC = qname("", "name", "");
const ATTR_ID_SEC = qname("", "id", "");
const ATTR_SLD_ID_REF = qname("", "id", "");
const findSectionLstElement = (presDocRoot) => {
	const extLst = firstChildElement(presDocRoot, NAME_EXT_LST);
	if (!extLst) return null;
	for (const ext of allChildElements(extLst, NAME_P_EXT)) if (getAttrValue(ext, ATTR_URI) === SECTION_LST_EXT_URI) return firstChildElement(ext, NAME_P14_SECTION_LST);
	return null;
};
const ensureSectionLst = (presDocRoot) => {
	let extLst = firstChildElement(presDocRoot, NAME_EXT_LST);
	if (!extLst) {
		extLst = elem(NAME_EXT_LST);
		presDocRoot.children.push(extLst);
	}
	for (const ext of allChildElements(extLst, NAME_P_EXT)) if (getAttrValue(ext, ATTR_URI) === SECTION_LST_EXT_URI) {
		let sectionLst = firstChildElement(ext, NAME_P14_SECTION_LST);
		if (!sectionLst) {
			sectionLst = elem(NAME_P14_SECTION_LST);
			ext.children.push(sectionLst);
		}
		return sectionLst;
	}
	const sectionLst = elem(NAME_P14_SECTION_LST, { prefixDecls: new Map([["p14", NS_P14]]) });
	const ext = elem(NAME_P_EXT, {
		attrs: [attr(ATTR_URI, SECTION_LST_EXT_URI)],
		children: [sectionLst]
	});
	extLst.children.push(ext);
	return sectionLst;
};
/**
* Returns every section defined in `<p14:sectionLst>`, with each
* section's slides resolved to `SlideData` handles via the
* presentation's `<p:sldIdLst>`. Sections referencing missing slides
* are dropped silently; empty arrays are preserved.
*
* Returns an empty array when no sectionLst is present.
*/
const getSlideSections = (pres) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (!presPart) return [];
	const doc = parseXml(decode$1(presPart.data));
	const sectionLst = findSectionLstElement(doc.root);
	if (!sectionLst) return [];
	const slideById = /* @__PURE__ */ new Map();
	if (pkg.getRels(PRES_PART_NAME)) {
		const presModel = readPresentationPart(doc.root);
		const slides = getSlides(pres);
		for (let i = 0; i < presModel.slides.length && i < slides.length; i++) slideById.set(String(presModel.slides[i].id), slides[i]);
	}
	const out = [];
	for (const sec of allChildElements(sectionLst, NAME_P14_SECTION)) {
		const name = getAttrValue(sec, ATTR_NAME_SEC) ?? "";
		const sldIdLst = firstChildElement(sec, NAME_P14_SLD_ID_LST);
		const slides = [];
		if (sldIdLst) for (const sldId of allChildElements(sldIdLst, NAME_P14_SLD_ID)) {
			const id = getAttrValue(sldId, ATTR_SLD_ID_REF);
			if (id !== null) {
				const slide = slideById.get(id);
				if (slide) slides.push(slide);
			}
		}
		out.push({
			name,
			slides
		});
	}
	return out;
};
/**
* Replaces the deck's section list with `sections`. Each section is
* given a fresh GUID `id` attribute (PowerPoint generates one per
* section; we synthesize a deterministic-ish one based on index +
* timestamp for v1).
*
* Pass `[]` to clear all sections — the helper drops the
* `<p14:sectionLst>` extension entirely when no sections remain.
*/
const setSlideSections = (pres, sections) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml is missing");
	const doc = parseXml(decode$1(presPart.data));
	const idBySlide = /* @__PURE__ */ new Map();
	const presModel = readPresentationPart(doc.root);
	const slides = getSlides(pres);
	for (let i = 0; i < presModel.slides.length && i < slides.length; i++) idBySlide.set(slides[i], String(presModel.slides[i].id));
	const idByPartName = /* @__PURE__ */ new Map();
	if (presModel.slides.length > 0) {
		const presRels = pkg.getRels(PRES_PART_NAME);
		if (presRels) for (const s of presModel.slides) {
			const rel = presRels.items.find((r) => r.id === s.rId);
			if (!rel) continue;
			const slideName = rel.target.startsWith("/") ? rel.target : `/ppt/${rel.target}`;
			idByPartName.set(slideName, String(s.id));
		}
	}
	const sldIdFor = (slide) => {
		const direct = idBySlide.get(slide);
		if (direct) return direct;
		return idByPartName.get(slide[SLIDE_PART_NAME]) ?? null;
	};
	if (sections.length === 0) {
		const extLst = firstChildElement(doc.root, NAME_EXT_LST);
		if (extLst) {
			extLst.children = extLst.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "ext" && getAttrValue(c, ATTR_URI) === SECTION_LST_EXT_URI));
			if (extLst.children.length === 0) doc.root.children = doc.root.children.filter((c) => c !== extLst);
		}
		presPart.data = encode$1(serializeXml(doc));
		return;
	}
	const sectionLst = ensureSectionLst(doc.root);
	sectionLst.children = sections.map((section, i) => {
		const id = `{${Date.now().toString(16).padStart(8, "0").slice(-8).toUpperCase().slice(0, 8)}-${String(i).padStart(4, "0")}-4000-8000-000000000000}`;
		const sldIds = [];
		for (const slide of section.slides) {
			const sldId = sldIdFor(slide);
			if (sldId !== null) sldIds.push(elem(NAME_P14_SLD_ID, { attrs: [attr(ATTR_SLD_ID_REF, sldId)] }));
		}
		return elem(NAME_P14_SECTION, {
			attrs: [attr(ATTR_NAME_SEC, section.name), attr(ATTR_ID_SEC, id)],
			children: [elem(NAME_P14_SLD_ID_LST, { children: sldIds })]
		});
	});
	presPart.data = encode$1(serializeXml(doc));
};
//#endregion
//#region src/internal/parts/duplicate-graph.ts
/** Clone owned dependencies without interpreting their bodies or relationship types. */
function duplicatePartGraph(pkg, source, destination, sharedTypes) {
	const parts = new Map(pkg.parts.map((part) => [part.name.toLowerCase(), part]));
	const occupied = new Set(parts.keys());
	const copies = new Map([[source.toLowerCase(), destination]]);
	const pending = [source];
	const planned = [];
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	occupied.add(destination.toLowerCase());
	const counters = /* @__PURE__ */ new Map();
	const allocate = (name) => {
		const dot = name.lastIndexOf(".");
		const split = dot > name.lastIndexOf("/") ? dot : name.length;
		const stem = name.slice(0, split);
		const extension = name.slice(split);
		let n = counters.get(name.toLowerCase()) ?? 1;
		let candidate;
		do
			candidate = partName(`${stem}-copy${n++}${extension}`);
		while (occupied.has(candidate.toLowerCase()));
		counters.set(name.toLowerCase(), n);
		occupied.add(candidate.toLowerCase());
		return candidate;
	};
	for (let index = 0; index < pending.length; index++) {
		const name = pending[index];
		const part = parts.get(name.toLowerCase());
		if (!part) throw new Error(`Cannot duplicate missing dependency ${name}`);
		const copy = copies.get(name.toLowerCase());
		planned.push({
			name: copy,
			contentType: part.contentType,
			data: new Uint8Array(part.data)
		});
		const relsPart = parts.get(relsPartNameFor(name).toLowerCase());
		if (!relsPart) continue;
		const doc = parseXml(decoder.decode(relsPart.data));
		for (const element of doc.root.children) {
			if (element.kind !== "element" || element.name.localName !== "Relationship" || element.name.namespaceURI !== NS.relationships) continue;
			const target = element.attrs.find((attribute) => attribute.name.namespaceURI === "" && attribute.name.localName === "Target");
			const type = element.attrs.find((attribute) => attribute.name.namespaceURI === "" && attribute.name.localName === "Type")?.value;
			const mode = element.attrs.find((attribute) => attribute.name.namespaceURI === "" && attribute.name.localName === "TargetMode")?.value;
			if (!target || !type) throw new Error(`Invalid relationship in ${relsPart.name}`);
			if (mode === "External") continue;
			const resolved = resolveTarget(name, target.value);
			if (!parts.has(resolved.toLowerCase())) throw new Error(`Cannot duplicate missing dependency ${resolved}`);
			let mapped = copies.get(resolved.toLowerCase());
			if (!mapped && !sharedTypes.has(type)) {
				mapped = allocate(resolved);
				copies.set(resolved.toLowerCase(), mapped);
				pending.push(resolved);
			}
			element.attrs = element.attrs.map((attribute) => attribute === target ? {
				...attribute,
				value: mapped ?? resolved
			} : attribute);
		}
		planned.push({
			name: relsPartNameFor(copy),
			contentType: relsPart.contentType,
			data: encoder.encode(serializeXml(doc))
		});
	}
	const names = new Set(parts.keys());
	for (const part of planned) {
		const key = part.name.toLowerCase();
		if (names.has(key)) throw new Error(`Cannot duplicate into existing part ${part.name}`);
		names.add(key);
	}
	for (const part of planned) pkg.addPart(part.name, part.contentType, part.data);
}
//#endregion
//#region src/api/fn/slide-deck.ts
const ensureSldIdLst = (presentationRoot) => {
	const existing = firstChildElement(presentationRoot, NAME_SLD_ID_LST$1);
	if (existing !== null) return existing;
	const fresh = elem(NAME_SLD_ID_LST$1);
	const masterLst = firstChildElement(presentationRoot, NAME_SLD_MASTER_ID_LST);
	if (masterLst === null) {
		presentationRoot.children.unshift(fresh);
		return fresh;
	}
	const idx = presentationRoot.children.indexOf(masterLst);
	presentationRoot.children.splice(idx + 1, 0, fresh);
	return fresh;
};
const allocateSldId = (sldIdLst) => {
	let max = 255;
	for (const sldId of allChildElements(sldIdLst, NAME_SLD_ID$1)) {
		const raw = getAttrValue(sldId, ATTR_ID$2);
		if (raw === null) continue;
		const n = Number.parseInt(raw, 10);
		if (Number.isFinite(n) && n > max) max = n;
	}
	const next = Math.max(256, max + 1);
	if (next > 2147482623) throw new Error(`sldId allocator exhausted (next would be ${next}, max ${SLD_ID_MAX})`);
	return next;
};
const allocateSlideN = (pkg) => {
	let next = 1;
	for (const p of pkg.parts) {
		const m = p.name.match(/^\/ppt\/slides\/slide(\d+)\.xml$/);
		if (m?.[1] !== void 0) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n) && n >= next) next = n + 1;
		}
	}
	return next;
};
const requirePresentationDoc = (pkg) => {
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml is missing");
	const doc = parseXml(decode$1(presPart.data));
	if (doc.root.name.namespaceURI !== NAME_PRESENTATION.namespaceURI || doc.root.name.localName !== "presentation") throw new Error("presentation.xml root is not <p:presentation>");
	return doc;
};
/**
* Adds a new slide bound to `layout`. Returns the new `SlideData`.
*
* Allocates a fresh part name, sldId, and rId; clones layout
* placeholders into the slide; writes `[Content_Types].xml`, the
* slide's `.rels`, presentation's `.rels`, and `<p:sldIdLst>`. The
* deck-cache on `pres` is invalidated so the next `getSlides` call
* sees the new entry.
*/
/**
* Convenience over `addSlide` that picks a layout automatically:
*
*   1. The layout with `<p:sldLayout type="blank">`, if present.
*   2. Otherwise, the first available layout (alphabetical by
*      part name).
*
* Throws when the package carries no layouts at all (which would
* be a structurally-broken deck).
*/
const addBlankSlide = (pres) => {
	const blank = findSlideLayoutByType(pres, "blank");
	if (blank) return addSlide(pres, { layout: blank });
	const layouts = getSlideLayouts(pres);
	if (layouts.length === 0) throw new Error("addBlankSlide: package has no slide layouts to inherit from");
	return addSlide(pres, { layout: layouts[0] });
};
/**
* Sugar over `addSlide` + `setSlideTitle` + `setSlideBody` for the
* "title + body" pattern. Picks the `obj` (Title and Content)
* layout when present, falling back to the first layout with a
* body placeholder.
*
* Throws if no layout in the package offers a body slot.
*/
const addContentSlide = (pres, opts) => {
	const layout = findSlideLayoutByType(pres, "obj") ?? getSlideLayouts(pres).find((l) => getSlideLayoutPlaceholders(l).some((p) => p.type === null || p.type === "body"));
	if (!layout) throw new Error("addContentSlide: no layout with a body placeholder found");
	const slide = addSlide(pres, { layout });
	if (opts.title !== void 0) setSlideTitle(slide, opts.title);
	if (opts.body !== void 0) setSlideBody(slide, opts.body);
	return slide;
};
/**
* Sugar over `addSlide` + `setSlideTitle` for the section-divider
* pattern. Picks `<p:sldLayout type="secHead">` when present (the
* PowerPoint "Section Header" layout); otherwise falls back to a
* `title`-typed layout or the first available layout.
*/
const addSectionHeaderSlide = (pres, title) => {
	const layout = findSlideLayoutByType(pres, "secHead") ?? findSlideLayoutByType(pres, "title") ?? getSlideLayouts(pres)[0];
	if (!layout) throw new Error("addSectionHeaderSlide: package has no slide layouts to inherit from");
	const slide = addSlide(pres, { layout });
	setSlideTitle(slide, title);
	return slide;
};
/**
* Sugar over `addSlide` + `setSlideTitle` for the common
* "title slide + set heading" pattern. Picks the `title` layout
* first, then falls back to the first non-blank layout.
*
* Throws when the package carries no layouts at all.
*/
const addTitleSlide = (pres, title) => {
	const layout = findSlideLayoutByType(pres, "title") ?? findSlideLayoutByType(pres, "obj") ?? null ?? getSlideLayouts(pres).find((l) => getSlideLayoutType(l) !== "blank") ?? getSlideLayouts(pres)[0];
	if (!layout) throw new Error("addTitleSlide: package has no slide layouts to inherit from");
	const slide = addSlide(pres, { layout });
	setSlideTitle(slide, title);
	return slide;
};
const addSlide = (pres, options) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const layout = options.layout;
	const layoutPart = layout[LAYOUT_PART];
	const layoutPartName = layout[LAYOUT_PART_NAME];
	const presDoc = requirePresentationDoc(pkg);
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml is missing");
	const sldIdLst = ensureSldIdLst(presDoc.root);
	const newSldId = allocateSldId(sldIdLst);
	const slideN = allocateSlideN(pkg);
	const newSlidePartName = partName(`/ppt/slides/slide${slideN}.xml`);
	const layoutCsld = firstChildElement(layoutPart.root, NAME_CSLD);
	if (!layoutCsld) throw new Error(`layout ${layoutPartName} missing <p:cSld>`);
	const layoutSpTree = firstChildElement(layoutCsld, NAME_SP_TREE);
	if (!layoutSpTree) throw new Error(`layout ${layoutPartName} missing <p:spTree>`);
	const slideBytes = encode$1(serializeXml(buildSlideFromLayout(layoutSpTree)));
	pkg.addPart(newSlidePartName, SLIDE_CONTENT_TYPE, slideBytes);
	const slideRels = emptyRels();
	slideRels.items.push({
		id: "rId1",
		type: REL_TYPES.slideLayout,
		target: `../slideLayouts/${basename(layoutPartName)}`,
		targetMode: "Internal"
	});
	pkg.setRels(newSlidePartName, slideRels);
	const presRels = pkg.getRels(PRES_PART_NAME) ?? emptyRels();
	const newRId = nextRelId(presRels.items.map((r) => r.id));
	presRels.items.push({
		id: newRId,
		type: REL_TYPES.slide,
		target: `slides/slide${slideN}.xml`,
		targetMode: "Internal"
	});
	pkg.setRels(PRES_PART_NAME, presRels);
	sldIdLst.children.push(elem(NAME_SLD_ID$1, { attrs: [attr(ATTR_ID$2, String(newSldId)), attr(ATTR_R_ID$1, newRId)] }));
	presPart.data = encode$1(serializeXml(presDoc));
	if (pres._slidesCache !== null) {
		const added = buildSlideData(pkg, newSlidePartName, slideBytes);
		pres._slidesCache = [...pres._slidesCache, added];
		return added;
	}
	const slides = getSlides(pres);
	const last = slides[slides.length - 1];
	if (!last) throw new Error("addSlide: post-condition failed; slide not in cache");
	return last;
};
/**
* Drops relationships in other parts that point at `removed`, and the
* `<a:hlinkClick>` / `<a:hlinkHover>` elements that carried them.
*
* A slide-jump click action stores a `slide` relationship on the *referring*
* slide. Removing the target leaves that relationship pointing at a deleted
* part, which PowerPoint rejects and which makes a later `duplicateSlide` of
* the referring slide fail on the missing dependency.
*/
const dropRelsPointingAtSlide = (pkg, removed) => {
	for (const part of pkg.parts) {
		if (part.name === removed || part.name.endsWith(".rels")) continue;
		const rels = pkg.getRels(part.name);
		if (!rels) continue;
		const dangling = new Set(rels.items.filter((rel) => {
			if (rel.type !== REL_TYPES.slide || rel.targetMode === "External") return false;
			return (rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(part.name, rel.target)) === removed;
		}).map((rel) => rel.id));
		if (dangling.size === 0) continue;
		rels.items = rels.items.filter((rel) => !dangling.has(rel.id));
		pkg.setRels(part.name, rels);
		const doc = parseXml(decode$1(part.data));
		stripHlinksWithRelId(doc.root, dangling);
		part.data = encode$1(serializeXml(doc));
	}
};
/** Removes every `<a:hlinkClick>` / `<a:hlinkHover>` whose `r:id` is in `relIds`. */
const stripHlinksWithRelId = (element, relIds) => {
	element.children = element.children.filter((child) => {
		if (child.kind !== "element") return true;
		if (!(child.name.namespaceURI === NS.dml && (child.name.localName === "hlinkClick" || child.name.localName === "hlinkHover"))) return true;
		const rId = getAttrValue(child, ATTR_R_ID$1);
		return rId === null || !relIds.has(rId);
	});
	for (const child of childElements(element)) stripHlinksWithRelId(child, relIds);
};
/**
* Removes the given slide from the deck. Removes the `<p:sldId>`, the
* `presentation.xml.rels` entry, and the slide part + its `.rels` part.
*
* Media parts are intentionally NOT cleaned up — they may be shared
* with other slides. The freed `sldId` is NOT reused on subsequent
* `addSlide` calls (PowerPoint quirk, see plan §Risks).
*/
const removeSlide = (pres, slide) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const slidePartName = slide[SLIDE_PART_NAME];
	if (pkg.getPart(slidePartName) === null) throw new Error(`removeSlide: ${slidePartName} not present in package`);
	const presRels = pkg.getRels(PRES_PART_NAME);
	if (!presRels) throw new Error("presentation.xml has no rels");
	const slideTargetRel = `slides/${basename(slidePartName)}`;
	const removedRel = presRels.items.find((r) => r.type === REL_TYPES.slide && r.target === slideTargetRel);
	if (!removedRel) throw new Error(`presentation.xml.rels missing entry for slide ${slidePartName}`);
	presRels.items = presRels.items.filter((r) => r.id !== removedRel.id);
	pkg.setRels(PRES_PART_NAME, presRels);
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml missing");
	const presDoc = parseXml(decode$1(presPart.data));
	const sldIdLst = firstChildElement(presDoc.root, NAME_SLD_ID_LST$1);
	if (sldIdLst !== null) sldIdLst.children = sldIdLst.children.filter((c) => {
		if (c.kind !== "element") return true;
		if (c.name.namespaceURI !== NS.pml || c.name.localName !== "sldId") return true;
		return getAttrValue(c, ATTR_R_ID$1) !== removedRel.id;
	});
	presPart.data = encode$1(serializeXml(presDoc));
	pkg.removePart(relsPartNameFor(slidePartName));
	pkg.removePart(slidePartName);
	dropRelsPointingAtSlide(pkg, slidePartName);
	pres._slidesCache = null;
};
/**
* Reorders every slide in the deck via a custom comparator. The
* comparator is invoked with two `SlideData` handles and returns the
* usual `Array.prototype.sort` ordering (-1 / 0 / 1).
*
*   sortSlides(pres, (a, b) => getSlideTitle(a)?.localeCompare(getSlideTitle(b) ?? '') ?? 0);
*
* Internally walks `<p:sldIdLst>` and re-emits its `<p:sldId>` children
* in the new order. Slide parts and rels are untouched — only the
* order in which PowerPoint plays them changes.
*/
const sortSlides = (pres, compareFn) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml missing");
	const doc = parseXml(decode$1(presPart.data));
	const sldIdLst = firstChildElement(doc.root, NAME_SLD_ID_LST$1);
	if (!sldIdLst) return;
	const slides = getSlides(pres);
	const presRels = pkg.getRels(PRES_PART_NAME);
	if (!presRels) return;
	const slideByRId = /* @__PURE__ */ new Map();
	for (const slide of slides) {
		const rel = presRels.items.find((r) => r.type === REL_TYPES.slide && r.target === `slides/${basename(slide[SLIDE_PART_NAME])}`);
		if (rel) slideByRId.set(rel.id, slide);
	}
	const sldIdElements = sldIdLst.children.filter((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "sldId");
	const sortedSlides = [...slides].sort(compareFn);
	const newOrder = [];
	for (const slide of sortedSlides) {
		let matchedRId;
		for (const [rId, s] of slideByRId.entries()) if (s === slide) {
			matchedRId = rId;
			break;
		}
		if (matchedRId === void 0) continue;
		const el = sldIdElements.find((e) => getAttrValue(e, ATTR_R_ID$1) === matchedRId);
		if (el) newOrder.push(el);
	}
	sldIdLst.children = [...sldIdLst.children.filter((c) => !(c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "sldId")), ...newOrder];
	presPart.data = encode$1(serializeXml(doc));
	pres._slidesCache = null;
};
/**
* Reverses the slide order across the whole deck. Built on
* `sortSlides` for predictable rels behavior.
*/
const reverseSlides = (pres) => {
	const indexBy = /* @__PURE__ */ new Map();
	for (const [i, slide] of getSlides(pres).entries()) indexBy.set(slide, i);
	sortSlides(pres, (a, b) => (indexBy.get(b) ?? 0) - (indexBy.get(a) ?? 0));
};
/**
* Swaps the positions of the slides at `indexA` and `indexB`.
* No-op when the indices are equal. Throws on out-of-range indices.
* Implemented on top of `moveSlide` for predictable rels behavior.
*/
const swapSlides = (pres, indexA, indexB) => {
	if (indexA === indexB) return;
	const slides = getSlides(pres);
	const a = slides[indexA];
	const b = slides[indexB];
	if (!a) throw new RangeError(`swapSlides: indexA ${indexA} out of range (have ${slides.length})`);
	if (!b) throw new RangeError(`swapSlides: indexB ${indexB} out of range (have ${slides.length})`);
	const [lo, hi] = indexA < indexB ? [indexA, indexB] : [indexB, indexA];
	moveSlide(pres, slides[lo], hi);
	moveSlide(pres, getSlides(pres)[hi - 1], lo);
};
/**
* Reorders a slide. The slide's identity (part, rels, sldId) is
* unchanged — only `<p:sldIdLst>`'s child order changes.
*/
const moveSlide = (pres, slide, toIndex) => {
	const pkg = pres[INTERNAL_PACKAGE];
	const slideRelTarget = `slides/${basename(slide[SLIDE_PART_NAME])}`;
	const presRels = pkg.getRels(PRES_PART_NAME);
	if (!presRels) throw new Error("presentation.xml has no rels");
	const slideRel = presRels.items.find((r) => r.type === REL_TYPES.slide && r.target === slideRelTarget);
	if (!slideRel) throw new Error(`moveSlide: slide ${slide[SLIDE_PART_NAME]} has no rel`);
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml missing");
	const presDoc = parseXml(decode$1(presPart.data));
	const sldIdLst = firstChildElement(presDoc.root, NAME_SLD_ID_LST$1);
	if (!sldIdLst) throw new Error("presentation.xml has no <p:sldIdLst>");
	const target = sldIdLst.children.filter((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "sldId").find((e) => getAttrValue(e, ATTR_R_ID$1) === slideRel.id);
	if (!target) throw new Error(`moveSlide: <p:sldId> for ${slideRel.id} not found`);
	const remaining = sldIdLst.children.filter((c) => c !== target);
	const remainingSldIds = remaining.filter((c) => c.kind === "element" && c.name.namespaceURI === NS.pml && c.name.localName === "sldId");
	const clamped = Math.max(0, Math.min(toIndex, remainingSldIds.length));
	if (clamped === remainingSldIds.length) remaining.push(target);
	else {
		const before = remainingSldIds[clamped];
		const insertAt = before === void 0 ? remaining.length : remaining.indexOf(before);
		remaining.splice(insertAt, 0, target);
	}
	sldIdLst.children = remaining;
	presPart.data = encode$1(serializeXml(presDoc));
	pres._slidesCache = null;
};
/**
* Duplicates a slide. Returns the new `SlideData` appended to deck order.
*
* Charts, embedded workbooks, notes and other owned dependencies are copied.
* Layouts, masters, themes, media and links to other slides remain shared.
* Unknown dependency bodies are retained without interpreting their content.
*/
const duplicateSlide = (pres, slide) => {
	const pkg = pres[INTERNAL_PACKAGE];
	if (slide[INTERNAL_PACKAGE] !== pkg) throw new Error("duplicateSlide: slide belongs to another presentation");
	const sourcePartName = slide[SLIDE_PART_NAME];
	if (!pkg.getPart(sourcePartName)) throw new Error(`duplicateSlide: source ${sourcePartName} not found`);
	const presPart = pkg.getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml missing");
	const presDoc = parseXml(decode$1(presPart.data));
	const sldIdLst = ensureSldIdLst(presDoc.root);
	const newSldId = allocateSldId(sldIdLst);
	const slideN = allocateSlideN(pkg);
	const newSlidePartName = partName(`/ppt/slides/slide${slideN}.xml`);
	duplicatePartGraph(pkg, sourcePartName, newSlidePartName, new Set([
		REL_TYPES.slideLayout,
		REL_TYPES.slideMaster,
		REL_TYPES.notesMaster,
		REL_TYPES.handoutMaster,
		REL_TYPES.theme,
		REL_TYPES.slide,
		REL_TYPES.image,
		REL_TYPES.media,
		REL_TYPES.video,
		REL_TYPES.audio
	]));
	const presRels = pkg.getRels(PRES_PART_NAME) ?? emptyRels();
	const newRId = nextRelId(presRels.items.map((r) => r.id));
	presRels.items.push({
		id: newRId,
		type: REL_TYPES.slide,
		target: `slides/slide${slideN}.xml`,
		targetMode: "Internal"
	});
	pkg.setRels(PRES_PART_NAME, presRels);
	sldIdLst.children.push(elem(NAME_SLD_ID$1, { attrs: [attr(ATTR_ID$2, String(newSldId)), attr(ATTR_R_ID$1, newRId)] }));
	presPart.data = encode$1(serializeXml(presDoc));
	if (pres._slidesCache !== null) {
		const added = buildSlideData(pkg, newSlidePartName, pkg.getPart(newSlidePartName).data);
		pres._slidesCache = [...pres._slidesCache, added];
		return added;
	}
	const slides = getSlides(pres);
	const dup = slides[slides.length - 1];
	if (!dup) throw new Error("duplicateSlide: post-condition failed");
	return dup;
};
/**
* Convenience over `addSlide` + `moveSlide`. Inserts the new slide
* at the given 0-based index (clamped to `[0, getSlides(pres).length]`).
*/
const addSlideAt = (pres, atIndex, options) => {
	moveSlide(pres, addSlide(pres, options), atIndex);
	const slides = getSlides(pres);
	return slides[Math.max(0, Math.min(atIndex, slides.length - 1))];
};
/**
* Convenience over `duplicateSlide` + `moveSlide`. Duplicates `slide`
* and inserts the duplicate at `atIndex` instead of at the end.
*/
const duplicateSlideAt = (pres, atIndex, slide) => {
	moveSlide(pres, duplicateSlide(pres, slide), atIndex);
	const slides = getSlides(pres);
	return slides[Math.max(0, Math.min(atIndex, slides.length - 1))];
};
const collectRelRefs = (el, into) => {
	for (const a of el.attrs) if (a.name.namespaceURI === NS.officeDocRels) into.add(a.value);
	for (const c of el.children) if (c.kind === "element") collectRelRefs(c, into);
};
const IMPORTED_MEDIA_REL_TYPES = new Set([
	REL_TYPES.image,
	REL_TYPES.media,
	REL_TYPES.video,
	REL_TYPES.audio
]);
const pruneDanglingGraphicFrames = (el, keptRelIds) => {
	el.children = el.children.filter((c) => {
		if (c.kind !== "element") return true;
		if (c.name.namespaceURI === NS.pml && c.name.localName === "graphicFrame") {
			const refs = /* @__PURE__ */ new Set();
			collectRelRefs(c, refs);
			for (const id of refs) if (!keptRelIds.has(id)) return false;
		}
		return true;
	});
	for (const c of el.children) if (c.kind === "element") pruneDanglingGraphicFrames(c, keptRelIds);
};
/**
* Imports a slide from another presentation into `targetPres`. The
* slide's part bytes are copied verbatim; image rels are followed and
* the linked media is copied into the target package with fresh part
* names. The new slide is bound to the supplied `targetLayout` so it
* still renders without the original deck's layouts.
*
* Limitations (v1):
*
*   - Only image / video / audio rels are copied across. Other rels (charts,
*     embedded workbooks, oleObjects, comments) are dropped from the imported
*     slide. A diagnostic message is appended for each dropped rel.
*   - Hyperlinks (external URLs) are preserved.
*   - Slide → notesSlide is dropped (notes don't follow imports).
*
* Returns the new `SlideData` appended to `targetPres`.
*/
const importSlide = (targetPres, sourceSlide, targetLayout) => {
	const sourcePkg = sourceSlide[INTERNAL_PACKAGE];
	const sourcePartName = sourceSlide[SLIDE_PART_NAME];
	const sourcePart = sourcePkg.getPart(sourcePartName);
	if (!sourcePart) throw new Error(`importSlide: source ${sourcePartName} not found`);
	const sourceRels = sourcePkg.getRels(sourcePartName);
	const targetPkg = targetPres[INTERNAL_PACKAGE];
	const presPart = targetPkg.getPart(PRES_PART_NAME);
	if (!presPart) throw new Error("presentation.xml missing in target");
	const presDoc = parseXml(decode$1(presPart.data));
	const sldIdLst = ensureSldIdLst(presDoc.root);
	const newSldId = allocateSldId(sldIdLst);
	const slideN = allocateSlideN(targetPkg);
	const newSlidePartName = partName(`/ppt/slides/slide${slideN}.xml`);
	targetPkg.addPart(newSlidePartName, sourcePart.contentType, new Uint8Array(sourcePart.data));
	const newRels = emptyRels();
	const layoutPartName = targetLayout[LAYOUT_PART_NAME];
	if (targetPkg.getPart(layoutPartName) === null) throw new Error(`importSlide: layout ${layoutPartName} not in target package`);
	const layoutRelId = nextRelId(sourceRels?.items.map((r) => r.id) ?? []);
	newRels.items.push({
		id: layoutRelId,
		type: REL_TYPES.slideLayout,
		target: `../slideLayouts/${basename(layoutPartName)}`,
		targetMode: "Internal"
	});
	const importedMedia = /* @__PURE__ */ new Map();
	if (sourceRels !== null) for (const rel of sourceRels.items) {
		if (rel.type === REL_TYPES.slideLayout) continue;
		if (rel.type === REL_TYPES.notesSlide) continue;
		if (IMPORTED_MEDIA_REL_TYPES.has(rel.type)) {
			if (rel.targetMode === "External") {
				newRels.items.push({ ...rel });
				continue;
			}
			const mediaName = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(sourcePartName, rel.target);
			let target = importedMedia.get(mediaName);
			if (target === void 0) {
				const mediaPart = sourcePkg.getPart(mediaName);
				if (!mediaPart) continue;
				const dotIdx = mediaName.lastIndexOf(".");
				const extension = dotIdx >= 0 ? mediaName.slice(dotIdx + 1) : "bin";
				const stem = rel.type === REL_TYPES.image ? "image" : "media";
				let nextN = 1;
				const re = new RegExp(`^/ppt/media/${stem}(\\d+)\\.`);
				for (const p of targetPkg.parts) {
					const m = p.name.match(re);
					if (m?.[1] !== void 0) {
						const n = Number.parseInt(m[1], 10);
						if (Number.isFinite(n) && n >= nextN) nextN = n + 1;
					}
				}
				const newMediaName = partName(`/ppt/media/${stem}${nextN}.${extension}`);
				setOpcDefault(targetPkg, extension.toLowerCase(), mediaPart.contentType);
				targetPkg.addPart(newMediaName, mediaPart.contentType, new Uint8Array(mediaPart.data));
				target = `../media/${stem}${nextN}.${extension}`;
				importedMedia.set(mediaName, target);
			}
			newRels.items.push({
				id: rel.id,
				type: rel.type,
				target,
				targetMode: "Internal"
			});
			continue;
		}
		if (rel.type === REL_TYPES.hyperlink) {
			newRels.items.push({ ...rel });
			continue;
		}
	}
	targetPkg.setRels(newSlidePartName, newRels);
	const newPart = targetPkg.getPart(newSlidePartName);
	if (newPart) {
		const keptRelIds = new Set(newRels.items.map((r) => r.id));
		const bodyDoc = parseXml(decode$1(newPart.data));
		const bodyRefs = /* @__PURE__ */ new Set();
		collectRelRefs(bodyDoc.root, bodyRefs);
		let hasDangling = false;
		for (const id of bodyRefs) if (!keptRelIds.has(id)) {
			hasDangling = true;
			break;
		}
		if (hasDangling) {
			pruneDanglingGraphicFrames(bodyDoc.root, keptRelIds);
			newPart.data = encode$1(serializeXml(bodyDoc));
		}
	}
	const presRels = targetPkg.getRels(PRES_PART_NAME) ?? emptyRels();
	const newRId = nextRelId(presRels.items.map((r) => r.id));
	presRels.items.push({
		id: newRId,
		type: REL_TYPES.slide,
		target: `slides/slide${slideN}.xml`,
		targetMode: "Internal"
	});
	targetPkg.setRels(PRES_PART_NAME, presRels);
	sldIdLst.children.push(elem(NAME_SLD_ID$1, { attrs: [attr(ATTR_ID$2, String(newSldId)), attr(ATTR_R_ID$1, newRId)] }));
	presPart.data = encode$1(serializeXml(presDoc));
	targetPres._slidesCache = null;
	const slides = getSlides(targetPres);
	const last = slides[slides.length - 1];
	if (!last) throw new Error("importSlide: post-condition failed");
	return last;
};
/**
* Appends every slide from `sourcePres` into `targetPres`, in source
* order. Built on top of `importSlide`: media is propagated, charts
* are dropped (not yet supported across decks), and the slide's
* layout is rebound to `targetLayout` on the target side.
*
* `targetLayout` can be a single layout used for every imported
* slide (common), or a function called once per source slide for
* per-slide layout selection.
*
* Returns the imported slides in target order.
*/
const mergePresentations = (targetPres, sourcePres, targetLayout) => {
	const sourceSlides = getSlides(sourcePres);
	const out = [];
	const resolveLayout = typeof targetLayout === "function" ? targetLayout : () => targetLayout;
	for (let i = 0; i < sourceSlides.length; i++) {
		const src = sourceSlides[i];
		const layout = resolveLayout(src, i);
		out.push(importSlide(targetPres, src, layout));
	}
	return out;
};
//#endregion
//#region src/api/fn/shape-grouping.ts
/**
* Groups two or more top-level shapes into a single `<p:grpSp>`,
* returning the new group as a `SlideShapeData`. The group's
* slide-space bounds are the union of its members' bounds; the members
* keep their own relative position/size (nothing is rescaled). The
* target slide is taken from the first shape — every shape must belong
* to the same slide.
*
* Every shape must:
*   - belong to the same slide as the others,
*   - be a direct child of the slide's shape tree (not already nested
*     inside another group — ungroup first, then re-group),
*   - have an explicit `<a:xfrm>` (placeholders that inherit position
*     from the layout have none and can't be grouped),
*   - appear at most once in `shapes` (grouping the same shape twice
*     would duplicate its id).
*
* The group replaces its members at the position of the earliest one in
* z-order, so grouping doesn't change how the selection stacks against
* shapes that weren't part of it.
*/
const groupShapes = (shapes, opts = {}) => {
	if (shapes.length < 2) throw new Error("groupShapes: at least 2 shapes are required");
	const slide = shapes[0][SHAPE_SLIDE];
	const spTree = requireSpTree(slide);
	const elements = [];
	const seen = /* @__PURE__ */ new Set();
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const shape of shapes) {
		if (shape[SHAPE_SLIDE] !== slide) throw new Error("groupShapes: all shapes must belong to the same slide");
		const el = shape[SHAPE_ELEMENT];
		if (seen.has(el)) throw new Error(`groupShapes: shape "${shape[SHAPE_SNAPSHOT].name}" was passed twice`);
		seen.add(el);
		if (!spTree.children.includes(el)) throw new Error(`groupShapes: shape "${shape[SHAPE_SNAPSHOT].name}" is not a direct child of the slide (it may already be inside a group)`);
		const kind = shape[SHAPE_SNAPSHOT].kind;
		const pos = readPosition(el, kind);
		const size = readSize(el, kind);
		if (pos === null || size === null) throw new Error(`groupShapes: shape "${shape[SHAPE_SNAPSHOT].name}" has no explicit position/size (placeholders that inherit geometry from the layout can't be grouped)`);
		elements.push(el);
		minX = Math.min(minX, pos.x);
		minY = Math.min(minY, pos.y);
		maxX = Math.max(maxX, pos.x + size.w);
		maxY = Math.max(maxY, pos.y + size.h);
	}
	const grp = buildGroup({
		id: nextShapeId(slide),
		...opts.name !== void 0 ? { name: opts.name } : {},
		x: minX,
		y: minY,
		w: maxX - minX,
		h: maxY - minY,
		children: elements
	});
	const insertAt = Math.min(...elements.map((el) => spTree.children.indexOf(el)));
	spTree.children = spTree.children.filter((c) => c.kind !== "element" || !seen.has(c));
	spTree.children.splice(insertAt, 0, grp);
	commitSlideData(slide);
	rebuildShapesFromDocument(slide);
	const created = slide[SLIDE_SHAPES].find((s) => s[SHAPE_ELEMENT] === grp);
	if (!created) throw new Error("groupShapes: post-condition failed");
	return created;
};
/**
* Reverses `groupShapes`: removes the `<p:grpSp>` and re-inserts its
* immediate children as top-level shapes at the group's former position,
* rescaling each child's own transform so it keeps its on-slide position
* and size (matters when the group was moved/resized after creation, so
* its `off`/`ext` diverged from its `chOff`/`chExt`). Returns the
* children as fresh `SlideShapeData` handles, in their original order.
*
* Throws if `group` isn't a group shape, or its `<p:grpSpPr>` carries no
* `<a:xfrm>` (malformed — every authored group has one).
*/
const ungroupShapes = (group) => {
	if (group[SHAPE_SNAPSHOT].kind !== "group") throw new Error("ungroupShapes: shape is not a group");
	const transform = getGroupTransform(group);
	if (!transform) throw new Error("ungroupShapes: group has no <a:xfrm> on <p:grpSpPr>");
	const { outer, inner } = transform;
	const scaleX = inner.w === 0 ? 1 : outer.w / inner.w;
	const scaleY = inner.h === 0 ? 1 : outer.h / inner.h;
	const slide = group[SHAPE_SLIDE];
	const spTree = requireSpTree(slide);
	const groupEl = group[SHAPE_ELEMENT];
	const idx = spTree.children.indexOf(groupEl);
	if (idx < 0) throw new Error("ungroupShapes: group is not attached to the slide");
	const childElements = readGroupChildren(groupEl).map((child) => {
		const pos = readPosition(child.element, child.kind);
		const size = readSize(child.element, child.kind);
		if (pos !== null && size !== null) {
			const newX = Math.round(outer.x + (pos.x - inner.x) * scaleX);
			const newY = Math.round(outer.y + (pos.y - inner.y) * scaleY);
			setPosition(child.element, child.kind, newX, newY);
			setSize(child.element, child.kind, Math.round(size.w * scaleX), Math.round(size.h * scaleY));
		}
		return child.element;
	});
	spTree.children.splice(idx, 1, ...childElements);
	commitSlideData(slide);
	rebuildShapesFromDocument(slide);
	const byElement = new Map(slide[SLIDE_SHAPES].map((s) => [s[SHAPE_ELEMENT], s]));
	return childElements.map((el) => {
		const found = byElement.get(el);
		if (!found) throw new Error("ungroupShapes: post-condition failed");
		return found;
	});
};
//#endregion
//#region src/api/fn/media.ts
const DEFAULT_POSTER_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0AQMAAADfKmdSAAAABlBMVEUmJib///+/9FOwAAAAvUlEQVR42u3XMQ7DIBAEQOfnfhpP4QmUFAgiJUqdKa6xtFtPA8J36+tKkiRJkiR5RF4Mm8KucCrcCg/DpnAoXAq3wnMr7AqnwqXwMGwKu8KpcCukK//ApnAoXAq3QjnNF3aFU+FSeBg2hUPhVLgV/r/yH2wKRzls1YfZ5Rc+yh9F+cOd5R/XXT0AVvmQatWDlEczD3teH7yQypcmr2Fe7FoVuHxwneGCxJWrvBZy0eTqymU4fxhJkiRJkjwqbzMmJGbQfp8bAAAAAElFTkSuQmCC";
const defaultPoster = () => Uint8Array.from(atob(DEFAULT_POSTER_BASE64), (ch) => ch.charCodeAt(0));
const YOUTUBE_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com"
]);
const YOUTUBE_SHORT_HOST = "youtu.be";
const YOUTUBE_ID = /^[A-Za-z0-9_-]+$/;
const youtubeVideoId = (url) => {
	const segments = url.pathname.split("/").filter((s) => s !== "");
	if (url.hostname === YOUTUBE_SHORT_HOST) return segments[0] ?? null;
	if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
	if (segments[0] === "watch") return url.searchParams.get("v");
	if (segments[0] === "shorts" || segments[0] === "live") return segments[1] ?? null;
	return null;
};
const resolveOnlineVideoUrl = (input) => {
	let url;
	try {
		url = new URL(input);
	} catch {
		throw new Error(`addSlideMedia: url is not an absolute URL: ${JSON.stringify(input)}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`addSlideMedia: url must be http(s), got ${JSON.stringify(input)}`);
	const id = youtubeVideoId(url);
	if (id === null || !YOUTUBE_ID.test(id)) return url.href;
	return `https://www.youtube.com/embed/${id}?feature=oembed`;
};
const MEDIA_DIR = "/ppt/media/";
const nextMediaPartName = (pkg, stem, extension) => {
	let nextN = 1;
	const pattern = new RegExp(`^/ppt/media/${stem}(\\d+)\\.`);
	for (const p of pkg.parts) {
		const m = p.name.match(pattern);
		if (m?.[1] !== void 0) {
			const n = Number.parseInt(m[1], 10);
			if (n >= nextN) nextN = n + 1;
		}
	}
	return partName(`${MEDIA_DIR}${stem}${nextN}.${extension}`);
};
const bytesEqual = (a, b) => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};
const internClipPart = (pkg, extension, contentType, bytes) => {
	for (const p of pkg.parts) if (p.name.startsWith(MEDIA_DIR) && p.contentType === contentType && bytesEqual(p.data, bytes)) return p.name;
	const name = nextMediaPartName(pkg, "media", extension);
	setOpcDefault(pkg, extension, contentType);
	pkg.addPart(name, contentType, bytes);
	return name;
};
const resolveSource = (source) => {
	switch (source.kind) {
		case "online": return { url: resolveOnlineVideoUrl(source.url) };
		case "video": {
			const format = source.format ?? detectVideoFormat(source.data);
			if (format === null) throw new Error("addSlideMedia: could not detect the video format. Pass options.format explicitly.");
			const contentType = contentTypeForVideoFormat(format);
			return {
				data: source.data,
				extension: format,
				contentType
			};
		}
		case "audio": {
			const format = source.format ?? detectAudioFormat(source.data);
			if (format === null) throw new Error("addSlideMedia: could not detect the audio format. Pass options.format explicitly.");
			const contentType = contentTypeForAudioFormat(format);
			return {
				data: source.data,
				extension: format,
				contentType
			};
		}
	}
};
const DEFAULT_NAME_PREFIX = {
	video: "Video",
	audio: "Audio",
	online: "Online Media"
};
/**
* Adds a video, an audio clip or an online (URL) video to the slide. Returns
* the new picture shape — the clip's poster frame.
*
* Embedded clips are stored once per package: adding the same bytes again
* reuses the existing `/ppt/media/mediaN.<ext>` part. The container format is
* detected from the bytes (mp4 / m4v / mov / webm / avi / wmv, mp3 / wav / m4a /
* ogg / wma); pass `format` for anything the signature check cannot tell.
* Whether a clip plays depends on the codecs of the viewing application.
*
* The shape is an ordinary picture: `getShapeImageBytes` / `setShapeImage`
* read and replace the poster, `getShapeMedia` reads the clip.
*/
const addSlideMedia = (slide, opts) => {
	const x = emuCoordinate(opts.x, "addSlideMedia: x");
	const y = emuCoordinate(opts.y, "addSlideMedia: y");
	const w = emuExtent(opts.w, "addSlideMedia: w");
	const h = emuExtent(opts.h, "addSlideMedia: h");
	const source = resolveSource(opts);
	const poster = opts.poster ?? defaultPoster();
	const posterFormat = opts.posterFormat ?? detectImageFormat(poster);
	if (posterFormat === null) throw new Error("addSlideMedia: could not detect the poster image format. Pass options.posterFormat explicitly.");
	const pkg = slide[INTERNAL_PACKAGE];
	const slidePartName = slide[SLIDE_PART_NAME];
	const rels = pkg.getRels(slidePartName) ?? emptyRels();
	const usedIds = rels.items.map((r) => r.id);
	const relate = (type, target, targetMode) => {
		const existing = rels.items.find((r) => r.type === type && r.target === target && r.targetMode === targetMode);
		if (existing) return existing.id;
		const id = nextRelId(usedIds);
		usedIds.push(id);
		rels.items.push({
			id,
			type,
			target,
			targetMode
		});
		return id;
	};
	const relativeTarget = (name) => `../media/${name.slice(11)}`;
	const kind = opts.kind === "audio" ? "audio" : "video";
	const fileRelType = kind === "audio" ? REL_TYPES.audio : REL_TYPES.video;
	let rLink;
	let rMedia;
	if ("url" in source) rLink = relate(fileRelType, source.url, "External");
	else {
		const clipPart = internClipPart(pkg, source.extension, source.contentType, source.data);
		rMedia = relate(REL_TYPES.media, relativeTarget(clipPart), "Internal");
		rLink = relate(fileRelType, relativeTarget(clipPart), "Internal");
	}
	const posterExtension = extensionForFormat(posterFormat);
	const posterContentType = contentTypeForFormat(posterFormat);
	const posterPart = nextMediaPartName(pkg, "image", posterExtension);
	setOpcDefault(pkg, posterExtension, posterContentType);
	pkg.addPart(posterPart, posterContentType, poster);
	const rPoster = relate(REL_TYPES.image, relativeTarget(posterPart), "Internal");
	pkg.setRels(slidePartName, rels);
	const id = nextShapeId(slide);
	const pic = buildMediaPicture({
		id,
		name: opts.name ?? `${DEFAULT_NAME_PREFIX[opts.kind]} ${id}`,
		kind,
		rLink,
		...rMedia !== void 0 ? { rMedia } : {},
		rEmbed: rPoster,
		x,
		y,
		w,
		h
	});
	addMediaTimingNode(slide, kind, id);
	return appendAndReturnNewShape(slide, pic);
};
/**
* Returns the clip behind a media picture, or `null` when the shape is not
* one. Reads PowerPoint-, PptxGenJS- and python-pptx-authored media alike: the
* embedded part is taken from `<p14:media r:embed>` when present and from the
* DrawingML `r:link` otherwise; a relationship with an external target is
* reported as `'online'`.
*/
const getShapeMedia = (shape) => {
	if (shape[SHAPE_SNAPSHOT].kind !== "picture") return null;
	const ref = readPictureMediaRef(shape[SHAPE_ELEMENT]);
	if (ref === null) return null;
	const slide = shape[SHAPE_SLIDE];
	const pkg = slide[INTERNAL_PACKAGE];
	const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
	if (rels === null) return null;
	const relsById = new Map(rels.items.map((r) => [r.id, r]));
	for (const rId of [ref.mediaRId, ref.fileRId]) {
		const rel = rId === null ? void 0 : relsById.get(rId);
		if (rel === void 0) continue;
		if (rel.targetMode === "External") return {
			kind: "online",
			url: rel.target
		};
		const name = rel.target.startsWith("/") ? partName(rel.target) : resolveTarget(slide[SLIDE_PART_NAME], rel.target);
		const part = pkg.getPart(name);
		if (part) return {
			kind: ref.kind,
			partName: part.name,
			contentType: part.contentType,
			bytes: part.data
		};
	}
	return null;
};
/** Every shape on the slide that `getShapeMedia` reports a clip for. */
const findShapesWithMedia = (slide) => slide[SLIDE_SHAPES].filter((shape) => getShapeMedia(shape) !== null);
//#endregion
//#region src/api/index.ts
const VERSION = "0.21.0";
//#endregion
export { replaceTokensInPresentation as $, getTableCellAnchor as $a, appendSlideNotes as $i, getShapePreset as $n, getSlideLayoutType as $o, getShapeParagraphCount as $r, findCommentsBefore as $s, getShapeStroke as $t, getOutlineText as A, removeSlideNotes as Aa, getShapeImageBiLevelThreshold as Ai, setSlideLayout as An, setTableCellTextFormat as Ao, setShapePatternFill as Ar, getSlideColorMapOverride as As, setShapeText as At, getSlideLayoutCount as B, getPackageSize as Ba, getShapeImagePartName as Bi, getShapeAltTitle as Bn, getPresentationCreated as Bo, getShapeRunFormat as Br, getSlideMasterBackgroundPatternFill as Bs, findShapesByEffect as Bt, setSlideSections as C, getSlidesWithHyperlinks as Ca, savePresentation as Cc, findFlippedShapes as Ci, getShapeSlide as Cn, setTableCellAnchor as Co, setShapeAdjustValues as Cr, getEffectiveColorMap as Cs, getShapeTextColumns as Ct, findSlidesByNotes as D, getSlidesWithTables as Da, mm as Dc, findSlidesByLayoutPartName as Di, getSlideShapes as Dn, setTableCellParagraphs as Do, setShapeImageFill as Dr, getSlideBackgroundGradientFill as Ds, setShapeAlignment as Dt, findSlideByTitle as E, getSlidesWithOverlap as Ea, inches as Ec, findSlidesByLayoutName as Ei, getSlideLayout as En, setTableCellMargins as Eo, setShapeGradientFill as Er, getSlideBackground as Es, getShapeTextWrap as Et, getShapeAt as F, setSlideTransition as Fa, getShapeImageDuotone as Fi, getGroupChildren as Fn, getThumbnail as Fo, setShapeStrokeArrow as Fr, getSlideLayoutBackgroundShapes as Fs, setShapeTextDirection as Ft, getSlideXmlString as G, setMediaPartBytes as Ga, setShapeImageContrast as Gi, getShapeDescription as Gn, touchModified as Go, getParagraphBulletImageBytes as Gr, getShapeClickAction as Gs, setShapeShadow as Gt, getSlidePartName as H, getSlideMediaPartNames as Ha, hasShapeText as Hi, getShapeBoundsResolved as Hn, incrementRevision as Ho, resolveDrawingColorOpacity as Hr, setSlideBackground as Hs, getShapeEffects as Ht, getSlideAt as I, _internalPackageOf as Ia, getShapeImageFillBytes as Ii, getGroupTransform as In, removeThumbnail as Io, setShapeStrokeCap as Ir, getSlideLayoutShapes as Is, setShapeTextFormat as It, isSlideHidden as J, clearTableCellFill as Ja, SLIDE_SIZE_16_10 as Ji, getShapeKind as Jn, findSlideLayoutByPartName as Jo, getParagraphIndent as Jr, addSlideComment as Js, getShapeFill as Jt, getSlides as K, slidesUsingMediaPart as Ka, setShapeImageCrop as Ki, getShapeFlip as Kn, findLayoutsWithPlaceholderType as Ko, getParagraphBulletStyle as Kr, setShapeClickAction as Ks, getShapeGradientFill as Kt, getSlideCount as L, compactPackage as La, getShapeImageFormat as Li, getMaxShapeId as Ln, setThumbnail as Lo, setShapeStrokeCompound as Lr, getSlideMasterBackground as Ls, setShapeTextMargins as Lt, getPresentationText as M, setSlideNotes as Ma, getShapeImageBytes as Mi, centerShapeOnSlide as Mn, setTableRowHeight as Mo, setShapeRotation as Mr, getSlideLayoutBackgroundGradientFill as Ms, setShapeTextAutoFit as Mt, getPresentationTextLength as N, clearSlideTransition as Na, getShapeImageContrast as Ni, findShapesAtPoint as Nn, setTableStyleFlags as No, setShapeSize as Nr, getSlideLayoutBackgroundImageBytes as Ns, setShapeTextBodyRotationDeg as Nt, findSlidesByText as O, getVisibleSlides as Oa, pt as Oc, findSlidesByLayoutType as Oi, getSlidesWithEmptyPlaceholders as On, setTableCellText as Oo, setShapeNoFill as Or, getSlideBackgroundImageBytes as Os, setShapeBulletStyle as Ot, getPresentationTextLengthsBySlide as P, getSlideTransition as Pa, getShapeImageCrop as Pi, findShapesInRect as Pn, setTableStyleId as Po, setShapeStroke as Pr, getSlideLayoutBackgroundPatternFill as Ps, setShapeTextColumns as Pt, replaceTextInSlideNotes as Q, getTableCellAlignment as Qa, setSlideSize as Qi, getShapePosition as Qn, getSlideLayoutPlaceholders as Qo, getShapeHyperlinkTooltip as Qr, findCommentsAfter as Qs, getShapeFillOpacity as Qt, getSlideIndex as R, getMediaParts as Ra, getShapeImageLinkUrl as Ri, getMaxShapeIdInPresentation as Rn, getCoreProperties as Ro, setShapeStrokeDash as Rr, getSlideMasterBackgroundGradientFill as Rs, setShapeTextWrap as Rt, getSlideSections as S, getSlidesWithComments as Sa, loadPresentation as Sc, setShapeAnimation as Si, getShapeIndex as Sn, setTableCellAlignment as So, getShapeStrokeDash as Sr, setChartSpec as Ss, getShapeTextBodyRotationDeg as St, findSlideByText as T, getSlidesWithNotes as Ta, emu as Tc, findShapesOutsideCanvas as Ti, getShapesBounds as Tn, setTableCellFill as To, setShapeFlip as Tr, clearSlideBackground as Ts, getShapeTextMargins as Tt, getSlideText as U, listPackageParts as Ua, isShapeImageGrayscale as Ui, getShapeCenter as Un, setCoreProperties as Uo, getParagraphAlignment as Ur, setSlideBackgroundImage as Us, getShapeEffectsEffective as Ut, getSlideOutline as V, getPresentationSummary as Va, hasShapeImage as Vi, getShapeBounds as Vn, getPresentationModified as Vo, resolveDrawingColor as Vr, getSlideMasterShapes as Vs, getShapeEffect as Vt, getSlideTextLength as W, readPackagePart as Wa, setShapeImageBrightness as Wi, getShapeCustomGeometry as Wn, setExtendedProperties as Wo, getParagraphBullet as Wr, isChartSpec as Ws, setShapeGlow as Wt, replaceTextInPresentation as X, getSlideTables as Xa, SLIDE_SIZE_4_3 as Xi, getShapePlaceholderIdx as Xn, getSlideLayoutName as Xo, getParagraphLineSpacing as Xr, clearSlideComments as Xs, getShapeFillColorResolved as Xt, replaceTextInNotes as Y, getPresentationTableCountsBySlide as Ya, SLIDE_SIZE_16_9 as Yi, getShapeName as Yn, findSlideLayoutByType as Yo, getParagraphLevel as Yr, clearAllSlideComments as Ys, getShapeFillColor as Yt, replaceTextInSlide as Z, getTableCell as Za, getSlideSize as Zi, getShapePlaceholderType as Zn, getSlideLayoutPartName as Zo, getParagraphSpacing as Zr, findCommentAuthorByName as Zs, getShapeFillEffective as Zt, moveSlide as _, getPresentationNotesLengthsBySlide as _a, getPresentationTheme as _c, setSlidePlaceholders as _i, findShapesByText as _n, isChartShape as _o, shapesOverlap as _r, getShapeChartKind as _s, appendShapeText as _t, groupShapes as a, findSlidesWithChartTrendlines as aa, getCommentDate as ac, getShapeRunText as ai, getShapeStrokeJoin as an, getTableCellSpan as ao, getSlideMasterPartNames as ar, getShapeHyperlink as as, addSlideShape as at, sortSlides as b, getSlideNotesLength as ba, asColor as bc, findShapesWithAnimation as bi, findSlidePlaceholderByIdx as bn, removeTableColumn as bo, getShapePatternFill as br, getShapeChartSpec as bs, getShapeTextAutoFit as bt, addContentSlide as c, getAllHyperlinks as ca, getCommentText as cc, setParagraphBullet as ci, findEmptyPlaceholders as cn, getTableCells as co, isShapeHidden as cr, setShapeRunFormat as cs, bringShapeForward as ct, addSlideAt as d, getAllTables as da, getPresentationCommentCountsBySlide as dc, setParagraphSpacing as di, findShapeByText as dn, getTableRowHeights as do, pointInShape as dr, findChartsBySeriesName as ds, copyShape as dt, clearAllHyperlinks as ea, findCommentsByAuthor as ec, getShapeParagraphElements as ei, getShapeStrokeCap as en, getTableCellBorders as eo, getShapeRotation as er, getSlideLayoutUsageCounts as es, searchSlides as et, addTitleSlide as f, getDistinctHyperlinkUrls as fa, getPresentationCommenters as fc, setShapeRunHyperlink as fi, findShapeInPresentation as fn, getTableSize as fo, renameShape as fr, findChartsWithDataLabels as fs, getShapeZIndex as ft, mergePresentations as g, getPresentationNotesLength as ga, getPresentationFonts as gc, setSlideBody as gi, findShapesByPreset as gn, insertTableRow as go, setShapeHidden as gr, getShapeChartCategories as gs, setShapeZIndex as gt, importSlide as h, getPresentationHyperlinkCountsBySlide as ha, removeSlideComment as hc, getSlideTitle as hi, findShapesByName as hn, insertTableColumn as ho, setShapeDescription as hr, getPresentationChartKindCounts as hs, sendShapeToBack as ht, getShapeMedia as i, findSlidesWithChartKind as ia, getCommentAuthors as ic, getShapeRunHyperlinkTooltip as ii, getShapeStrokeEffective as in, getTableCellPosition as io, getSlideMasterPartName as ir, getParagraphPropertiesEffective as is, addSlideLine as it, getPresentationShapeCountsBySlide as j, replaceHyperlink as ja, getShapeImageBrightness as ji, translateShapes as jn, setTableColumnWidth as jo, setShapePosition as jr, getSlideLayoutBackground as js, setShapeTextAnchor as jt, getAllShapes as k, hasSlideNotes as ka, getPresentationImageCountsBySlide as ki, replaceTokensInSlide as kn, setTableCellTextDirection as ko, setShapeNoStroke as kr, getSlideBackgroundPatternFill as ks, setShapeParagraphs as kt, addSectionHeaderSlide as l, getAllImages as la, getCommentsSortedByDate as lc, setParagraphLevel as li, findShapeById as ln, getTableColumnWidths as lo, isShapePlaceholder as lr, addSlideChart as ls, bringShapeToFront as lt, duplicateSlideAt as m, getHiddenSlides as ma, getSlideComments as mc, getSlideBody as mi, findShapesByKind as mn, getTableStyleId as mo, setShapeBounds as mr, getPresentationChartCountsBySlide as ms, sendShapeBackward as mt, addSlideMedia as n, clearSlideHyperlinks as na, findSlidesWithCommentsByAuthor as nc, getShapeRunCount as ni, getShapeStrokeColorResolved as nn, getTableCellMargins as no, getShapeText as nr, getSlideLayouts as ns, slideHasAnimations as nt, ungroupShapes as o, getAllCharts as oa, getCommentPosition as oc, isParagraphBulletPicture as oi, getShapeStrokeOpacity as on, getTableCellText as oo, getSlideMasterUsageCounts as or, getShapeRunFormatEffective as os, addSlideTable as ot, duplicateSlide as p, getEmptySlides as pa, getSlideCommentAuthors as pc, setShapeRunText as pi, findShapesByHyperlink as pn, getTableStyleFlags as po, setShapeAltTitle as pr, findChartsWithTrendlines as ps, removeShape as pt, getSlidesByLayout as q, validatePresentation as qa, setShapeImageOpacity as qi, getShapeId as qn, findSlideLayout as qo, getParagraphEndFormat as qr, setShapeImage as qs, getShapeGradientFillEffective as qt, findShapesWithMedia as r, findSlidesByHyperlink as ra, getCommentAuthor as rc, getShapeRunHyperlink as ri, getShapeStrokeCompound as rn, getTableCellParagraphs as ro, getSlideMasterCount as rr, getUnusedSlideLayouts as rs, addSlideImage as rt, addBlankSlide as s, getAllComments as sa, getCommentSlide as sc, setParagraphAlignment as si, getShapeStrokeWidth as sn, getTableCellTextDirection as so, getUnusedSlideMasters as sr, setShapeHyperlink as ss, addSlideTextBox as st, VERSION as t, clearAllSlideNotes as ta, findCommentsByText as tc, getShapeRunClickAction as ti, getShapeStrokeColor as tn, getTableCellFill as to, getShapeSize as tr, getSlideLayoutUsageCountsByType as ts, setSlideHidden as tt, addSlide as u, getAllNotes as ua, getPresentationCommentCountsByAuthor as uc, setParagraphLineSpacing as ui, findShapeByName as un, getTableDimensions as uo, isShapeTextBox as ur, findChartByKind as us, clearSlideShapes as ut, removeSlide as v, getPresentationNotesText as va, setPresentationFonts as vc, setSlideTitle as vi, findShapesWithHyperlinks as vn, isTableShape as vo, clearShapeFill as vr, getShapeChartSeriesNames as vs, getShapeBodyPrEffective as vt, findSlideByPartName as w, getSlidesWithImages as wa, cm as wc, findOverlappingShapePairs as wi, getShapeXmlString as wn, setTableCellBorders as wo, setShapeFill as wr, resolveDeckBodyTextColor as ws, getShapeTextDirection as wt, swapSlides as x, getSlidesWithCharts as xa, createPresentation as xc, getShapeAnimation as xi, findSlidePlaceholders as xn, removeTableRow as xo, getShapeStrokeArrow as xr, getSlideCharts as xs, getShapeTextAutoFitParams as xt, reverseSlides as y, getSlideNotes as ya, setPresentationTheme as yc, clearSlideAnimations as yi, findSlidePlaceholder as yn, mergeTableCells as yo, clearShapeStroke as yr, getShapeChartSeriesValues as ys, getShapeTextAnchor as yt, getSlideInfo as z, getOrphanMediaPartNames as za, getShapeImageOpacity as zi, getShapeAdjustValues as zn, getExtendedProperties as zo, setShapeStrokeJoin as zr, getSlideMasterBackgroundImageBytes as zs, clearShapeEffects as zt };

