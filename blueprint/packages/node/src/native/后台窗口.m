// 仅载入节点启动的渲染子进程；隐藏 Cocoa 窗口并阻止激活，保留 GPU 渲染。
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <stdlib.h>
#include <string.h>

static void 隐藏窗口(NSWindow *window) {
    [window setAlphaValue:0.0];
    [window setIgnoresMouseEvents:YES];
    [window setExcludedFromWindowsMenu:YES];
}

static void 忽略激活(id self, SEL selector, BOOL flag) {}
static void 忽略窗口动作(id self, SEL selector) {}
static void 忽略窗口发送者(id self, SEL selector, id sender) {}
static NSInteger 忽略提醒(id self, SEL selector, NSRequestUserAttentionType type) { return 0; }
static BOOL 禁止激活策略(id self, SEL selector, NSApplicationActivationPolicy policy);
static IMP 原激活策略;
static IMP 原窗口排序;
static IMP 原透明度;
static IMP 原鼠标穿透;

static void 保持透明(id self, SEL selector, CGFloat alpha) {
    ((void (*)(id, SEL, CGFloat))原透明度)(self, selector, 0.0);
}
static void 保持鼠标穿透(id self, SEL selector, BOOL value) {
    ((void (*)(id, SEL, BOOL))原鼠标穿透)(self, selector, YES);
}
static BOOL 忽略进程激活(id self, SEL selector, NSApplicationActivationOptions options) { return NO; }

static BOOL 禁止激活策略(id self, SEL selector, NSApplicationActivationPolicy policy) {
    return ((BOOL (*)(id, SEL, NSApplicationActivationPolicy))原激活策略)(self, selector, NSApplicationActivationPolicyAccessory);
}
static void 后台排序(id self, SEL selector, NSWindowOrderingMode place, NSInteger other) {
    隐藏窗口(self);
    ((void (*)(id, SEL, NSWindowOrderingMode, NSInteger))原窗口排序)(self, selector,
        place == NSWindowOut ? NSWindowOut : NSWindowBelow, 0);
}
static void 后台显示(id self, SEL selector, id sender) {
    [self orderWindow:NSWindowBelow relativeTo:0];
}
// Godot 用 occlusionState 判断是否渲染。窗口透明时仍需离屏产图，而不是暂停渲染。
static NSWindowOcclusionState 可渲染(id self, SEL selector) { return NSWindowOcclusionStateVisible; }

static IMP 替换(Class type, SEL selector, IMP replacement) {
    Method method = class_getInstanceMethod(type, selector);
    return method ? method_setImplementation(method, replacement) : NULL;
}

__attribute__((constructor)) static void 装后台窗口(void) {
    if (!getenv("BLUEPRINT_BACKGROUND_TOOLS") || strcmp(getenv("BLUEPRINT_BACKGROUND_TOOLS"), "1")) return;
    @autoreleasepool {
        原激活策略 = 替换([NSApplication class], @selector(setActivationPolicy:), (IMP)禁止激活策略);
        替换([NSApplication class], @selector(activateIgnoringOtherApps:), (IMP)忽略激活);
        替换([NSApplication class], @selector(activate), (IMP)忽略窗口动作);
        替换([NSApplication class], @selector(requestUserAttention:), (IMP)忽略提醒);
        替换([NSRunningApplication class], @selector(activateWithOptions:), (IMP)忽略进程激活);
        原透明度 = 替换([NSWindow class], @selector(setAlphaValue:), (IMP)保持透明);
        原鼠标穿透 = 替换([NSWindow class], @selector(setIgnoresMouseEvents:), (IMP)保持鼠标穿透);
        原窗口排序 = 替换([NSWindow class], @selector(orderWindow:relativeTo:), (IMP)后台排序);
        替换([NSWindow class], @selector(orderFront:), (IMP)后台显示);
        替换([NSWindow class], @selector(orderFrontRegardless), (IMP)忽略窗口动作);
        替换([NSWindow class], @selector(makeKeyAndOrderFront:), (IMP)后台显示);
        替换([NSWindow class], @selector(makeKeyWindow), (IMP)忽略窗口动作);
        替换([NSWindow class], @selector(makeMainWindow), (IMP)忽略窗口动作);
        替换([NSWindow class], @selector(toggleFullScreen:), (IMP)忽略窗口发送者);
        替换([NSWindow class], @selector(occlusionState), (IMP)可渲染);
        setenv("BLUEPRINT_WINDOW_GUARD_LOADED", "1", 1);
    }
}
