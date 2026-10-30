# Blueprint User Guide

Apple Silicon Macs only for now (macOS 13 or later).

## Install

1. Download the `.dmg` from [Releases](https://github.com/wbohui123-sys/blueprint/releases/latest), open it, and drag Blueprint into Applications.
2. Double-click Blueprint. When macOS blocks it, click **Done**, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
3. Click **Add API**, pick DeepSeek, create a key on its platform, paste it in, and click **Verify and connect**.

If macOS says Blueprint is damaged, open Terminal, run this line, and double-click it again:

```bash
xattr -cr /Applications/Blueprint.app
```

To switch the interface language, go to **Settings → General → Language**.

## Use

1. Type what you want on the home page and click **Start building →**. Say what it is, who it's for and what counts as done, not how to do it. By default it first shows you a few directions and starts once you accept one.
2. Watch the canvas. Each card is a member. Orange is waiting for your answer. Red has stopped: click **Start All** to continue. The other colors need nothing from you.
3. Click a card: talk to it in **Chat**, and see what it made in **Files**.
4. To change direction, tell the **Lead Producer**. To change one piece, tell the lead of that piece.

Close the window and the work continues. macOS notifies you when it needs you. Quitting stops the work: reopen the project and click **Start All** to continue.

Big jobs run for tens of minutes to hours and use a lot of tokens, so start small. **Project usage** in the top bar shows what you've spent.

## Advanced

- **Collaboration:** spark thinks it through with you, build shows you the plan, solo does it all alone. Choose it under the gear next to the box (**Advanced settings**), or change it midway with **COLLAB** under the Lead Producer.
- **Effort:** high, max or ultra. Higher takes longer and costs more. It's in Advanced settings too; start with high.
- **Stop and restart:** ■ stops a card, ▶ continues it, ↻ restarts it. A restart can clear the files it made, and that can't be undone.
- **Add more later:** click the Lead Producer and choose **New stage**.
- **Other models:** **Manage APIs** at the bottom of the new project form connects OpenAI, Anthropic, Ollama and more.
- **Skills:** **Skills** in the side bar gives members working methods, such as Godot, Blender or PowerPoint.
- **Media API:** **Media API** in the side bar connects image, video and audio services.
- **Codex and Claude Code:** **Agent choice** in the side bar. Sign in, switch them on, and whole pieces of work can go to them.
- **Local software:** **Software** in the side bar installs FFmpeg, Godot, Blender and more in one click.
- **Help:** the question mark icon. Ask anything; it can change settings for you.

It can't click around websites or control other desktop apps yet.

Questions: [Issues](https://github.com/wbohui123-sys/blueprint/issues) or wbohui123@gmail.com. Want to build it with us? Read the [Developer Handbook](developer-handbook.md).
