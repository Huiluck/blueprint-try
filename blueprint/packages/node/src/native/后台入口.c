// Shell 传给普通子进程的轻量入口；只有 GUI 程序才加载 Cocoa 保护。
#include <crt_externs.h>
#include <dlfcn.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

__attribute__((constructor)) static void 装后台入口(void) {
    const char *enabled = getenv("BLUEPRINT_BACKGROUND_TOOLS");
    if (!enabled || strcmp(enabled, "1")) return;
    char path[PROC_PIDPATHINFO_MAXSIZE];
    if (proc_pidpath(getpid(), path, sizeof(path)) <= 0) return;
    const char *name = strrchr(path, '/');
    name = name ? name + 1 : path;
    const int godot = !strncasecmp(name, "godot", 5)
        && (!name[5] || strchr("._-", name[5]));
    if (!godot && !strstr(path, ".app/Contents/MacOS/")) return;
    int argc = *_NSGetArgc();
    char **argv = *_NSGetArgv();
    if (godot) {
        for (int i = 1; i < argc; i++) {
            if (!strcmp(argv[i], "--headless") ||
                (!strcmp(argv[i], "--display-driver") && i + 1 < argc && !strcmp(argv[i + 1], "headless"))) return;
        }
    }
    const char *library = getenv("BLUEPRINT_BACKGROUND_WINDOW_LIBRARY");
    if (!library || !*library) {
        fputs("后台窗口保护不可用；Godot 检查和导出请使用 --headless。\n", stderr);
        _exit(126);
    }
    if (godot) {
        // 在 main 前重新执行，传入静音驱动及窗口保护；绝对路径和 shell 变量同样适用。
        char **args = calloc((size_t)argc + 3, sizeof(char *));
        if (!args || setenv("DYLD_INSERT_LIBRARIES", library, 1)) _exit(126);
        args[0] = argv[0]; args[1] = "--audio-driver"; args[2] = "Dummy";
        for (int i = 1; i < argc; i++) args[i + 2] = argv[i];
        execv(path, args);
        perror("后台 Godot 启动失败");
        _exit(126);
    }
    if (!dlopen(library, RTLD_NOW | RTLD_LOCAL)) {
        fprintf(stderr, "后台窗口保护加载失败：%s\n", dlerror());
        _exit(126);
    }
}
