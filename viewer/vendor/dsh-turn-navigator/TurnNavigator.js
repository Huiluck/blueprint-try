// Extracted unchanged from @deepseek-ai/dsh-client-ui-chat 0.1.5-rc.2 lib/client.js.
// Copyright (c) 2026 DeepSeek. MIT; see LICENSE.
import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
const TurnNavigator_module_css_default = {
			"dsh-turn-mark-busy": "eGxaPq_dsh-turn-mark-busy",
			"dsh-turn-mark-enter": "eGxaPq_dsh-turn-mark-enter",
			"dsh-turn-preview-enter": "eGxaPq_dsh-turn-preview-enter",
			"fadeBottom": "eGxaPq_fadeBottom",
			"fadeTop": "eGxaPq_fadeTop",
			"frame": "eGxaPq_frame",
			"mark": "eGxaPq_mark",
			"markActive": "eGxaPq_markActive",
			"markBusy": "eGxaPq_markBusy",
			"markPosition": "eGxaPq_markPosition",
			"markPreview": "eGxaPq_markPreview",
			"markUnloaded": "eGxaPq_markUnloaded",
			"marks": "eGxaPq_marks",
			"preview": "eGxaPq_preview",
			"previewPrompt": "eGxaPq_previewPrompt",
			"previewResponse": "eGxaPq_previewResponse",
			"scroller": "eGxaPq_scroller",
			"slot": "eGxaPq_slot"
		};
/** Fixed pitch between neighbouring marks; overflow scrolls inside the frame. */
const TURN_SPACING_PX = 10;
/** Rail padding above the first mark and below the last one, per end. */
const RAIL_INSET_PX = 6;
/** Fade band the mask reserves at a scrollable end. */
const FADE_PX = 24;
function itemPosition(index) {
	return { "--turn-natural-position": `${String(index * TURN_SPACING_PX)}px` };
}
function frameStyle(count, scrollTop) {
	return {
		"--turn-natural-height": `${String((count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX)}px`,
		"--turn-rail-inset": `${String(RAIL_INSET_PX)}px`,
		"--turn-scroll-top": `${String(scrollTop)}px`
	};
}
function itemAtPointer(items, frame, scrollTop, clientY) {
	const offset = clientY - frame.getBoundingClientRect().top + scrollTop - RAIL_INSET_PX;
	return items[Math.max(0, Math.min(items.length - 1, Math.round(offset / TURN_SPACING_PX)))];
}
const RAIL_AT_REST = {
	top: 0,
	canScrollUp: false,
	canScrollDown: false
};
function railScrollState(scroller) {
	const top = scroller.scrollTop;
	return {
		top,
		canScrollUp: top > 1,
		canScrollDown: top < scroller.scrollHeight - scroller.clientHeight - 1
	};
}
function sameRailScrollState(left, right) {
	return left.top === right.top && left.canScrollUp === right.canScrollUp && left.canScrollDown === right.canScrollDown;
}
function TurnNavigatorRail({ items, activeTurn, busyTurn, onNavigate, t }) {
	const [previewTurn, setPreviewTurn] = (0, react.useState)(null);
	const [scrollState, setScrollState] = (0, react.useState)(RAIL_AT_REST);
	const scrollerRef = (0, react.useRef)(null);
	/** While the pointer works the rail, follow must not move it under the hand. */
	const pointerInsideRef = (0, react.useRef)(false);
	const previewId = (0, react.useId)();
	const syncScrollState = () => {
		const scroller = scrollerRef.current;
		if (scroller === null) return;
		const next = railScrollState(scroller);
		setScrollState((current) => sameRailScrollState(current, next) ? current : next);
	};
	(0, react.useEffect)(() => {
		const scroller = scrollerRef.current;
		if (scroller === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(syncScrollState);
		observer.observe(scroller);
		return () => {
			observer.disconnect();
		};
	}, []);
	(0, react.useEffect)(syncScrollState, [items.length]);
	(0, react.useEffect)(() => {
		const scroller = scrollerRef.current;
		const index = items.findIndex((item) => item.turn === activeTurn);
		if (scroller === null || index < 0 || pointerInsideRef.current) return;
		const markTop = index * TURN_SPACING_PX + RAIL_INSET_PX;
		const viewTop = scroller.scrollTop;
		const viewHeight = scroller.clientHeight;
		if (viewHeight <= 0 || markTop >= viewTop + FADE_PX && markTop <= viewTop + viewHeight - FADE_PX) return;
		const target = Math.max(0, markTop - viewHeight / 2);
		const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (typeof scroller.scrollTo === "function") scroller.scrollTo({
			top: target,
			behavior: reduced ? "auto" : "smooth"
		});
		else scroller.scrollTop = target;
		syncScrollState();
	}, [activeTurn, items]);
	if (items.length < 2) return null;
	const previewIndex = items.findIndex((item) => item.turn === previewTurn);
	const preview = previewIndex < 0 ? void 0 : items[previewIndex];
	const previewPosition = previewIndex < 0 ? void 0 : itemPosition(previewIndex);
	const previewAtPointer = (event) => {
		const scrollTop = scrollerRef.current?.scrollTop ?? 0;
		setPreviewTurn(itemAtPointer(items, event.currentTarget, scrollTop, event.clientY)?.turn ?? null);
	};
	const navigateAtPointer = (event) => {
		const scrollTop = scrollerRef.current?.scrollTop ?? 0;
		const item = itemAtPointer(items, event.currentTarget, scrollTop, event.clientY);
		if (item !== void 0) onNavigate(item);
	};
	const fadeClasses = [TurnNavigator_module_css_default.scroller];
	if (scrollState.canScrollUp) fadeClasses.push(TurnNavigator_module_css_default.fadeTop);
	if (scrollState.canScrollDown) fadeClasses.push(TurnNavigator_module_css_default.fadeBottom);
	return (0, react_jsx_runtime.jsx)("div", {
		className: TurnNavigator_module_css_default.slot,
		children: (0, react_jsx_runtime.jsxs)("nav", {
			className: TurnNavigator_module_css_default.frame,
			style: frameStyle(items.length, scrollState.top),
			"aria-label": t("chat.turnNavigation.label"),
			onClick: navigateAtPointer,
			onPointerMove: previewAtPointer,
			onPointerEnter: () => {
				pointerInsideRef.current = true;
			},
			onPointerLeave: () => {
				pointerInsideRef.current = false;
				setPreviewTurn(null);
			},
			children: [(0, react_jsx_runtime.jsx)("div", {
				ref: scrollerRef,
				className: fadeClasses.join(" "),
				onScroll: () => {
					syncScrollState();
				},
				children: (0, react_jsx_runtime.jsx)("div", {
					className: TurnNavigator_module_css_default.marks,
					children: items.map((item, index) => {
						const active = item.turn === activeTurn;
						const showingPreview = item.turn === previewTurn;
						const classes = [TurnNavigator_module_css_default.mark];
						if (item.anchor.kind === "unloaded") classes.push(TurnNavigator_module_css_default.markUnloaded);
						if (active) classes.push(TurnNavigator_module_css_default.markActive);
						else if (showingPreview) classes.push(TurnNavigator_module_css_default.markPreview);
						if (item.turn === busyTurn) classes.push(TurnNavigator_module_css_default.markBusy);
						return (0, react_jsx_runtime.jsx)("div", {
							className: TurnNavigator_module_css_default.markPosition,
							style: itemPosition(index),
							children: (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: classes.join(" "),
								"aria-label": t(item.anchor.kind === "loaded" ? "chat.turnNavigation.jump" : "chat.turnNavigation.jumpLoad", { turn: item.turn }),
								"aria-current": active ? "true" : void 0,
								"aria-busy": item.turn === busyTurn ? "true" : void 0,
								"aria-describedby": showingPreview ? previewId : void 0,
								onClick: (event) => {
									event.stopPropagation();
									onNavigate(item);
								},
								onFocus: () => {
									setPreviewTurn(item.turn);
								},
								onBlur: () => {
									setPreviewTurn(null);
								}
							})
						}, item.turn);
					})
				})
			}), preview !== void 0 && previewPosition !== void 0 && (0, react_jsx_runtime.jsxs)("div", {
				id: previewId,
				role: "tooltip",
				className: TurnNavigator_module_css_default.preview,
				style: previewPosition,
				children: [(0, react_jsx_runtime.jsx)("div", {
					className: TurnNavigator_module_css_default.previewPrompt,
					children: preview.prompt || t("chat.turnNavigation.turn", { turn: preview.turn })
				}), preview.response !== "" && (0, react_jsx_runtime.jsx)("div", {
					className: TurnNavigator_module_css_default.previewResponse,
					children: preview.response
				})]
			})]
		})
	});
}
/**
* Fixed-pitch rail of every known Turn — loaded marks scroll, unloaded marks
* page history in first — with hover and focus previews. Overflow scrolls
* inside the frame, gradient fades marking each scrollable end, and the
* active mark keeps itself in view while the pointer is elsewhere.
*
* Memoized because it renders two host elements per Turn while the
* enclosing view re-renders on every streaming delta: without the guard a long
* session rebuilds hundreds of marks per commit for a rail that only changes
* when a Turn is added, removed, or becomes active. Its props must therefore
* stay referentially stable across those commits.
*/
const TurnNavigator = (0, react.memo)(TurnNavigatorRail);

export { TurnNavigator };
