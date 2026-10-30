// 面板在哪一侧，图纸与看板就在对应侧让位；收起后避开 B 与视图按钮。
export function 视图留白({ leftOpen = true, leftWidth = 520, leftSide = "l" } = {}) {
  const occupied = leftOpen ? leftWidth + 40 : 24;
  const left = leftSide === "r" ? 24 : occupied;
  const right = leftSide === "r" ? occupied : 24;
  return { canvasLeft: left, canvasRight: right, overlayTop: !leftOpen && leftSide === "l" ? 80 : 16,
    boardLeft: left, boardRight: right, boardTop: leftOpen ? 20 : 80 };
}

export function 图纸工作区(width, insets) {
  const L = Math.min(width, insets.canvasLeft + 16), R = Math.max(L, width - insets.canvasRight);
  return { L, W: R - L, center: (L + R) / 2 };
}

// 平移同一段距离，保留缩放、纵向位置及用户当前看的范围。
export function 跟随工作区(camera, previous, next) {
  if (!previous || !previous.W || !next.W) return { ...camera };
  return { ...camera, x: camera.x + next.center - previous.center };
}
