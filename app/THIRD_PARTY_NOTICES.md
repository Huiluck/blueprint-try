# Third-party notices

Blueprint bundles DeepSeek Harness 0.2.1-alpha.2, Node.js and Electron. Each production dependency retains its license files inside `runtime/node_modules/`; the version and declared license inventory is `runtime/runtime-manifest.json`. Node's full license is `runtime/node/LICENSE`; Electron and Chromium notices are in `runtime/licenses/`. The headless browser used by project commands is Chromium's chrome-headless-shell, obtained through the pinned Playwright installer; its `LICENSE.headless_shell` and `ABOUT` files remain in `runtime/native-resources/browser/`.

Official external providers additionally bundle OpenAI Codex CLI 0.163.0 (Apache-2.0; pinned by this App through `overrides` in place of the provider's 0.153.4), Anthropic Claude Agent SDK 0.3.263 and its Claude Code 2.1.263 platform executable. Anthropic's retained `LICENSE.md` and platform notice govern those components; the DeepSeek MIT notice below does not apply to them. Their exact versions and platform packages are checked before preparing an independent runtime.

The terminal browser assets include xterm.js 6.0.0, FitAddon 0.11.0 and the official DeepSeek client models, with Zustand 4.5.7 and Immer 10.1.1 (MIT). Their original license files remain with the production packages. The browser bundle records input versions and SHA-256 checksums in `terminal-client/terminal-assets-manifest.json`.

The following MIT notice applies to DeepSeek Harness and the modified engine components. It does not cover Blueprint's own source, which is licensed under the GNU Affero General Public License v3.0 only; see `LICENSE`.

Scenario skills also retain their original notices next to bundled files: Phaser 4.2.1 and Three.js 0.186.0 browser builds (MIT), dsh-ppt 0.9.0 with Office Kit 0.21.0 and fflate 0.8.3, and GSAP 3.15.0 (GSAP standard no-charge license, linked in the package's retained README). Source URLs and integrity records are included in each skill. MarkItDown 0.1.8 is resolved from its Python lockfile into the current project's cache; its dependencies are not installed globally or copied into the App engine.

## Preview FFmpeg

The audio/video thumbnail component is a separate FFmpeg 9.0.2 executable, built from the unmodified official source under LGPL-2.1-or-later. The build disables GPL/nonfree and autodetected external libraries, networking and unused encoders. It only links macOS system libraries; the App invokes it as a separate process.

The exact corresponding source archive, LGPL license, upstream LICENSE.md, configure arguments and SHA-256 integrity record are distributed in `runtime/native-resources/media/`. The reproducible preparation command is `node app/scripts/preview-media-assets.mjs`; the source and checksum are pinned in that script. Users do not need Homebrew or Python for file-gallery media previews.

Windows packages do not bundle this component: the reproducible macOS build recipe is not used there, and the App leaves media thumbnails to an `ffmpeg` the user installs (the feature degrades to the original file when it is absent). No FFmpeg binary is redistributed in the Windows installer.

Node.js is bundled for both platforms. macOS takes the license file shipped by the `node-bin-darwin-arm64` package; Windows' `node-win-x64` package omits it, so the official Node v22.23.3 license text is vendored at `app/installer/Node-LICENSE.txt` and copied to `runtime/node/LICENSE`.

## DeepSeek Harness

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
