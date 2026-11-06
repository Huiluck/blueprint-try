<p align="center">
  <img src="docs/assets/logo.svg" width="88" alt="Blueprint">
</p>

<h1 align="center">Blueprint</h1>

<p align="center">
  <b>Give it a goal. Watch an organization grow.</b>
</p>

<p align="center">
  A visual multi-agent system. One sentence becomes a team of AI agents that plan, split the work, build, and put it all together, on a live canvas you can watch and steer.
</p>

<p align="center">
  <a href="https://github.com/wbohui123-sys/blueprint/releases/latest"><img src="https://img.shields.io/badge/download-Windows%2011%20%7C%20macOS%20(Apple%20Silicon)-111418?style=flat-square" alt="Download"></a>
  <img src="https://img.shields.io/badge/license-AGPL--3.0-111418?style=flat-square" alt="License">
  <a href="mailto:wbohui123@gmail.com"><img src="https://img.shields.io/badge/contact-email-4E9A72?style=flat-square" alt="Email"></a>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">中文</a>
</p>

<p align="center">
  <img src="docs/assets/hero.gif" width="100%" alt="One sentence grows into a tree of agents">
</p>

## What it does

You type one sentence. Blueprint grows a team to do it:

- A **Lead Producer** figures out what you actually want and breaks the work into stages.
- Each stage gets a **lead**, who splits it into parts and sets up a workspace for each one.
- Parts that are still big get their own lead. Parts that are one piece go to a **specialist** who builds it end to end.
- Results flow back up and get integrated, layer by layer, into one finished product.

No fixed roles, no workflow to draw. The structure grows from the task: a game might grow art, combat, levels and sound; a report grows research, data and writing.

And you see all of it. Every agent is a card on the canvas: what it's doing, where it's stuck, what it made, what it reported. Click any one to read its work or talk to it.

## Same prompt, different setups

Each game started from the same one-line prompt (written in Chinese), handed to every setup as is.

**Top-down shooter and tower defense**

https://github.com/user-attachments/assets/07f0aff9-cf56-4184-857f-eccb1f542617

**Soulslike boss fight**

https://github.com/user-attachments/assets/a61b1c01-2455-4620-81ce-e13bd3cfa7ee

| Cost (USD) | DeepSeek harness + DeepSeek v4.1 | Codex + GPT-6.1 Sol | Blueprint + DeepSeek v4.1 | Blueprint + DeepSeek directing Codex + GPT-6.1 Sol |
| --- | --- | --- | --- | --- |
| Top-down shooter | $0.45 | — | $6.43 † | — |
| Tower defense | $0.39 | — | $5.20 † | — |
| Boss fight | $0.40 | ~$3–4 (est.) | $6.03 | $37.84 † |

<sub>DeepSeek at off-peak API prices, converted at ¥7.1 = $1. † Cut off partway; the cost up to that point. In the video, 中途停止 means cut off partway, 预估 means estimate, and 指挥 means directing.</sub>

<details>
<summary>The prompts (translated)</summary>

- **Top-down shooter:** Mix Project Zomboid with Diablo-style looting into a top-down 3D horde shooter. An open parking lot at night: heavy atmosphere, strong effects, great shooting feel, strong art.
- **Tower defense:** A sci-fi tower defense game with high-end art: realistic pixel-art texture, rich detail, rich effects, strong atmosphere and immersion.
- **Boss fight:** Create an epic boss-fight scene like Demon's Souls: grand and magnificent, with an oppressive atmosphere and music, an exquisitely detailed, awe-inspiring enemy, exaggerated moves and English voice lines, and a tiny hero with only limited attacks. Focus on level art, atmosphere, epic scale and splendor. (Outdoor level)

</details>

## Features

- **Live canvas.** The whole team on one map. Color is status: running, waiting, needs you, done. Switch between rounds and stages.
- **Step in anytime.** Talk to any agent. Stop one without stopping the rest. Restart one, with or without its changes.
- **You choose how involved you are.** *Leave it all to you*, *Just check the result*, *Work together*, or *Deeply involved*. Change it anytime.
- **Every agent gets its own workspace.** Its own git branch, only its slice of the project checked out, plus the tools to test its part. Work gets merged back when it's done.
- **Bring your own workers.** Agents run on any model you connect. Big pieces can also go to Codex or Claude Code on your machine.
- **Plug in what you need.** 20+ skills (Godot, Blender, Three.js, Phaser, FFmpeg, Word/Excel/PowerPoint, and more), image/video/audio APIs, and one-click install of local tools.

## Quick start

1. Download the latest installer from [Releases](https://github.com/wbohui123-sys/blueprint/releases/latest): `.exe` for Windows 11 (x64), `.dmg` for Apple Silicon Macs.
2. Run it. Neither build is code-signed yet, so the first launch is blocked: on Windows choose **More info → Run anyway**; on macOS go to **System Settings → Privacy & Security** and click **Open Anyway**. If macOS says the app is damaged, run:
   ```bash
   xattr -cr /Applications/Blueprint.app
   ```
3. Add an API key. DeepSeek, OpenAI, Anthropic, multi-model gateways, Ollama, or any OpenAI-compatible endpoint.
4. Type what you want, hit **Start building →**, and watch it grow.

Big tasks run for tens of minutes to hours and use a lot of tokens. Start with something small, and check **Project usage** in the top bar to see time and cost.

Everything else is in the [User Guide](docs/user-guide.md).

## How it works

```
Your goal
└─ Lead Producer        what do you want? how many stages?
   └─ Stage lead        split into parts, set up a workspace for each
      ├─ Lead           still big? split again
      │  └─ Specialist  build it, test it, hand it back
      └─ Specialist     (any model, Codex, or Claude Code)
         ↑ results flow back up and get integrated
```

Before every step, each lead asks itself one question: *what should I do next?* Figure out the problem, plan, build, integrate, or check the result. It's a loop the agent drives, not a fixed pipeline.

Every agent hands back the same report: what it did, how it checked it, what it couldn't check, and what needs a human. That's what lets dozens of agents work in parallel without losing track of each other.

## Limitations

- Windows 11 (x64) and macOS on Apple Silicon.
- Not code-signed yet. The first launch needs the extra step above.
- Can't click around websites or control other desktop apps yet. It can screenshot and look at pages.
- Codex and Claude Code workers are one-shot: they can't take messages halfway through.
- Young project. Expect rough edges and bugs.

## Build from source

Requires Windows 11 x64 or an Apple Silicon Mac, plus Node 22.19+. Windows builds also need Git for Windows for its `patch.exe`.

```bash
npm --prefix app ci
npm --prefix app start
```

Packaging and tests: [app/README.md](app/README.md).

Blueprint is a set of plugins on top of [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness). Plain JavaScript, no build step.

## Contact

- Email: [wbohui123@gmail.com](mailto:wbohui123@gmail.com)
- Bugs and ideas: [Issues](https://github.com/wbohui123-sys/blueprint/issues)
- Want to build this with us? Read the [Developer Handbook](docs/developer-handbook.md).

## License

[AGPL-3.0](LICENSE)
