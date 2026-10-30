"""不用 AI 的模型体检：一张联系表加一份读数，看一次就知道模型的形、尺度、网格和动作。

blender -b --factory-startup --python-exit-code 1 --python 模型体检.py -- <模型> <输出目录> [--身高 米] [--边长 384] [--重做]

联系表：正、侧、背、顶四个正交视角（旁边站一个 1.75 米的人），3/4 视角，正面、侧面纯黑剪影，
缩到 128 像素的正面剪影，每个动作取 5 个时刻的侧面剪影排成一行。
读数：尺寸、离地、原点、面数、各部件、网格破损、UV、材质贴图、缩放、骨骼与蒙皮、每个动作动没动、脚下漂多少。
同一份文件（按内容指纹）体检过就直接给上次的结果，不重新渲染；别的节点拿到的是同一份。
贴图放在模型外面、只改了贴图的，加 --重做。
"""
import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import 渲染预览 as 预览  # noqa: E402

版本 = "1"  # 联系表或读数的算法改了就加一，旧缓存自动作废
人高 = 1.75
标签字体 = Path("/System/Library/Fonts/Hiragino Sans GB.ttc")


def parse():
    parser = argparse.ArgumentParser(prog="模型体检.py")
    parser.add_argument("model")
    parser.add_argument("folder")
    parser.add_argument("--身高", dest="expected_height", type=float, default=None)
    parser.add_argument("--边长", dest="size", type=int, default=384)
    parser.add_argument("--重做", dest="redo", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def fingerprint(model: Path, args):
    digest = hashlib.sha256()
    with model.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    digest.update(f"{版本}|{args.expected_height}|{args.size}".encode())
    return digest.hexdigest()[:12]


# ---------- 读数 ----------

def 三角面(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
    return count


def 部件读数(meshes):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    parts = []
    for obj in meshes:
        points = 预览.world_vertices([obj])
        lo, hi = points.min(axis=0), points.max(axis=0)
        parts.append({"名": obj.name, "三角面": 三角面(obj, depsgraph), "尺寸（米）": [round(float(v), 3) for v in hi - lo],
                      "材质": [s.material.name for s in obj.material_slots if s.material]})
    return sorted(parts, key=lambda p: -p["三角面"])


def 网格问题(meshes):
    问题 = []
    for obj in meshes:
        mesh = obj.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        # glTF、FBX 导入时按法线、UV 把顶点拆开，封闭的盒子也会被数成开口；先在副本上合并重合点再数
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        破边 = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        开口边 = sum(1 for e in bm.edges if e.is_boundary)
        孤点 = sum(1 for v in bm.verts if not v.link_edges)
        零面 = sum(1 for f in bm.faces if f.calc_area() < 1e-10)
        bm.free()
        这个 = []
        if 破边: 这个.append(f"非流形边 {破边} 条（三个以上面共用一条边，导出、布尔、细分容易出错）")
        if 开口边: 这个.append(f"开口边 {开口边} 条（网格不封闭；有意做的薄片可以不管）")
        if 孤点: 这个.append(f"孤立点 {孤点} 个")
        if 零面: 这个.append(f"面积为零的面 {零面} 个")
        if not mesh.uv_layers: 这个.append("没有 UV（贴不了图）")
        if not any(s.material for s in obj.material_slots): 这个.append("没有材质")
        if any(abs(v - 1) > 1e-4 for v in obj.scale): 这个.append(f"缩放没应用 {tuple(round(v, 3) for v in obj.scale)}")
        if obj.matrix_world.determinant() < 0: 这个.append("镜像了（缩放为负，法线会反）")
        if 这个:
            问题.append({"部件": obj.name, "问题": 这个})
    return 问题


def 贴图读数():
    images = [i for i in bpy.data.images if i.source == "FILE"]
    return [{"名": i.name, "像素": list(i.size), "读到": bool(min(i.size) > 0)} for i in images]


def 骨骼读数(meshes):
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    读数 = []
    for arm in armatures:
        bones = arm.data.bones
        绑上的 = [m for m in meshes if any(md.type == "ARMATURE" and md.object == arm for md in m.modifiers)]
        没权重 = 0
        for m in 绑上的:
            # glTF 导出会把没有权重的顶点挂到占位的 neutral_bone 上，它不动，等于没有权重
            groups = {g.index for g in m.vertex_groups if g.name in bones and g.name != "neutral_bone"}
            没权重 += sum(1 for v in m.data.vertices if not any(g.group in groups and g.weight > 0 for g in v.groups))
        读数.append({"骨架": arm.name, "骨头": len(bones), "变形骨": sum(1 for b in bones if b.use_deform),
                     "根骨": [b.name for b in bones if b.parent is None][:6], "蒙皮网格": [m.name for m in 绑上的],
                     "没有权重的顶点": 没权重})
    return 读数


def 原点读数(lo, hi):
    roots = [o for o in bpy.context.scene.objects
             if o.parent is None and o.type in {"MESH", "ARMATURE", "EMPTY"} and o.visible_get()]
    脚底中心 = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    return [{"物体": o.name, "原点": [round(v, 3) for v in o.matrix_world.translation],
             "离脚底中心（米）": round((o.matrix_world.translation - 脚底中心).length, 3)} for o in roots[:6]]


# ---------- 动作 ----------

def 动作清单():
    """(物体, 动作)：活动动作和 NLA 里的都算；glTF 导入的每段动画是一条 NLA 片段。"""
    pairs, seen = [], set()
    for obj in bpy.context.scene.objects:
        data = obj.animation_data
        if not data:
            continue
        actions = [data.action] if data.action else []
        actions += [s.action for t in data.nla_tracks for s in t.strips if s.action]
        for action in actions:
            if (obj.name, action.name) not in seen:
                seen.add((obj.name, action.name))
                pairs.append((obj, action))
    return pairs


def 只放这一个(target, action):
    for obj in bpy.context.scene.objects:
        data = obj.animation_data
        if not data:
            continue
        for track in data.nla_tracks:
            track.mute = True
        data.action = action if obj == target else None
        if obj == target and hasattr(data, "action_slot") and getattr(action, "slots", None):
            # 5.x 的动作分槽：挑给这个物体用的那一槽
            slot = next((s for s in action.slots if s.target_id_type == obj.id_type), action.slots[0])
            try:
                data.action_slot = slot
            except (TypeError, RuntimeError):
                pass


def 动作读数(meshes, scene, samples=9):
    读数 = []
    fps = scene.render.fps / scene.render.fps_base
    for obj, action in 动作清单()[:8]:
        只放这一个(obj, action)
        start, end = action.frame_range
        frames = np.linspace(start, end, samples) if end > start else [start]
        sets, lows, centers, heights = [], [], [], []
        for f in frames:
            scene.frame_set(int(math.floor(f)), subframe=float(f - math.floor(f)))
            pts = 预览.world_vertices(meshes)
            sets.append(pts)
            lows.append(float(pts[:, 2].min()))
            heights.append(float(pts[:, 2].max() - pts[:, 2].min()))
            centers.append(pts[:, :2].mean(axis=0))
        moved = max(float(np.linalg.norm(p - sets[0], axis=1).max()) for p in sets)
        drift = max(float(np.linalg.norm(c - centers[0])) for c in centers)
        读数.append({"物体": obj.name, "动作": action.name, "帧": [round(start, 2), round(end, 2)],
                     "秒": round((end - start) / fps, 2), "最大位移（米）": round(moved, 3),
                     "动了没有": "动了" if moved > 0.001 else "没动（有动作数据，但取样时姿态不变）",
                     "最低点（米）": [round(min(lows), 3), round(max(lows), 3)],
                     "高度（米）": [round(min(heights), 3), round(max(heights), 3)],
                     "水平漂移（米）": round(drift, 3), "取样帧": [round(float(f), 2) for f in frames]})
    return 读数


# ---------- 画面 ----------

def 参照人():
    body = bpy.data.meshes.new("参照人")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, segments=16, radius1=0.2, radius2=0.2, depth=1.45, cap_ends=True,
                          matrix=Matrix.Translation((0, 0, 0.725)))
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.15,
                              matrix=Matrix.Translation((0, 0, 人高 - 0.15)))
    bm.to_mesh(body)
    bm.free()
    obj = bpy.data.objects.new("参照人（1.75 米）", body)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def 地面线(lo, hi):
    """一条贴着 0 米的薄板，比模型宽一圈：离地、陷进地里在图上直接看得出来。"""
    pad = 0.1 * max(hi.x - lo.x, hi.y - lo.y, 0.5)
    t = max(0.004 * (hi.z - lo.z), 0.01)
    mesh = bpy.data.meshes.new("地面线")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(hi.x - lo.x + 2 * pad, hi.y - lo.y + 2 * pad, t), verts=bm.verts)
    bmesh.ops.translate(bm, vec=((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, -t / 2), verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("地面线（0 米）", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def 舞台(scene, size):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.display.render_aa = "8"
    if not scene.world:
        scene.world = bpy.data.worlds.new("体检环境")
    camera = bpy.data.objects.new("体检镜头", bpy.data.cameras.new("体检镜头"))
    camera.data.type = "ORTHO"
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def 着色(scene, silhouette):
    shading = scene.display.shading
    if silhouette:
        shading.light = "FLAT"
        shading.color_type = "SINGLE"
        shading.single_color = (0, 0, 0)
        shading.show_cavity = False
        scene.world.color = (1, 1, 1)
    else:
        shading.light = "STUDIO"
        shading.color_type = "TEXTURE"
        shading.show_cavity = True
        scene.world.color = (0.62, 0.64, 0.67)


def 拍(scene, camera, points, toward, path, size):
    """正交镜头从 toward 方向看过去，把 points 全框进画面。"""
    toward = Vector(toward).normalized()
    turn = (-toward).to_track_quat("-Z", "Y" if abs(toward.z) < 0.99 else "X")
    right, up = turn @ Vector((1, 0, 0)), turn @ Vector((0, 1, 0))
    xs, ys, zs = points @ np.array(right), points @ np.array(up), points @ np.array(toward)
    center = right * float((xs.min() + xs.max()) / 2) + up * float((ys.min() + ys.max()) / 2)
    extent = max(float(xs.max() - xs.min()), float(ys.max() - ys.min()), 1e-3)
    camera.data.ortho_scale = extent * 1.1
    camera.data.clip_start = 0.01
    camera.data.clip_end = float(zs.max() - zs.min()) * 4 + 10
    camera.location = center + toward * (float(zs.max()) + extent)
    camera.rotation_euler = turn.to_euler()
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return str(path)


def 摆人(person, lo, hi, axis):
    """参照人站在模型旁边、和模型同一个地面；axis 是画面里的水平方向。"""
    gap = max(0.4, 0.08 * float((hi - lo).length))
    if axis == "x":
        person.location = (lo.x - gap - 0.2, (lo.y + hi.y) / 2, lo.z)
    else:
        person.location = ((lo.x + hi.x) / 2, hi.y + gap + 0.2, lo.z)


def 带人点(points, *extra):
    """取景要把参照人和地面线也框进来（藏起来的不算）。"""
    shown = [o for o in extra if not o.hide_render]
    return np.concatenate([points] + [预览.world_vertices([o]) for o in shown]) if shown else points


def 写标签(sheet: Path, labels, size, columns):
    """拼好以后在每格左上角写上这格是什么；缺 magick 或中文字体就不写，报告里按顺序列出。"""
    if not shutil.which("magick") or not 标签字体.is_file():
        return False
    command = ["magick", str(sheet), "-gravity", "northwest", "-font", str(标签字体), "-pointsize", "18", "-fill", "#d22"]
    for index, text in enumerate(labels):
        if text:
            command += ["-annotate", f"+{index % columns * size + 8}+{index // columns * size + 6}", text]
    subprocess.run(command + [str(sheet)], check=True)
    return True


def 拼(tiles, output: Path, size, columns):
    rows = math.ceil(len(tiles) / columns)
    sheet = np.ones((rows * size, columns * size, 4), dtype=np.float32)
    for index, (path, _small) in enumerate(tiles):
        if path is None:
            continue
        image = bpy.data.images.load(path)
        w, h = image.size
        pixels = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(h, w, 4)
        if h < size:  # 小图按最近邻放大，看的就是它缩小后的颗粒
            pixels = np.repeat(np.repeat(pixels, size // h, axis=0), size // w, axis=1)
        ph, pw = pixels.shape[:2]
        top = (rows - 1 - index // columns) * size + (size - ph) // 2  # Blender 像素从左下角开始
        left = (index % columns) * size + (size - pw) // 2
        sheet[top:top + ph, left:left + pw] = pixels
        bpy.data.images.remove(image)
    result = bpy.data.images.new("体检联系表", columns * size, rows * size, alpha=True)
    result.pixels.foreach_set(sheet.ravel())
    result.filepath_raw = str(output)
    result.file_format = "PNG"
    result.save()
    return rows


def 画面(scene, meshes, points, lo, hi, folder, size, actions):
    camera = 舞台(scene, size)
    person = 参照人()
    ground = 地面线(lo, hi)
    tiles, labels = [], []

    def add(name, path, small=False):
        tiles.append((path, small))
        labels.append(name)

    视角 = [("正视（从 -Y 看）", (0, -1, 0), "x"), ("侧视（从 +X 看）", (1, 0, 0), "y"),
            ("背视（从 +Y 看）", (0, 1, 0), "x"), ("顶视", (0, 0, 1), "x")]
    着色(scene, silhouette=False)
    for name, toward, axis in 视角:
        摆人(person, lo, hi, axis)
        person.hide_render = ground.hide_render = name == "顶视"
        add(name, 拍(scene, camera, 带人点(points, person, ground), toward, folder / f"{len(tiles)}.png", size))
    person.hide_render, ground.hide_render = True, False
    add("3/4 视角", 拍(scene, camera, 带人点(points, ground), (0.7, -0.7, 0.45), folder / f"{len(tiles)}.png", size))
    person.hide_render = False
    着色(scene, silhouette=True)
    for name, toward, axis in [("剪影·正", (0, -1, 0), "x"), ("剪影·侧", (1, 0, 0), "y")]:
        摆人(person, lo, hi, axis)
        add(name, 拍(scene, camera, 带人点(points, person, ground), toward, folder / f"{len(tiles)}.png", size))
    摆人(person, lo, hi, "x")
    small = max(32, size // 3)
    add(f"剪影·正 缩到 {small} 像素", 拍(scene, camera, 带人点(points, person, ground), (0, -1, 0), folder / f"{len(tiles)}.png", small), True)
    columns = 5 if actions else 4
    while len(tiles) % columns:
        add("", None)
    # 动作条带：每个动作取 5 个时刻的侧面剪影，镜头按整段动作的范围框好，几格之间能直接比
    person.hide_render = True
    for item in actions[:4]:
        obj = bpy.data.objects[item["物体"]]
        action = bpy.data.actions[item["动作"]]
        只放这一个(obj, action)
        start, end = item["帧"]
        moments = np.linspace(start, end, 5)
        span = []
        for f in moments:
            scene.frame_set(int(math.floor(f)), subframe=float(f - math.floor(f)))
            span.append(预览.world_vertices(meshes))
        frame_box = 带人点(np.concatenate(span), ground)
        for k, f in enumerate(moments):
            scene.frame_set(int(math.floor(f)), subframe=float(f - math.floor(f)))
            path = folder / f"{len(tiles)}.png"
            # 镜头按整段动作的范围取景，五格同一个取景，动了多少直接比得出来
            拍(scene, camera, frame_box, (1, 0, 0), path, size)
            add(f"{item['动作']} {round((f - start) / max(end - start, 1e-6) * 100)}%", str(path))
        while len(tiles) % columns:
            add("", None)
    return tiles, labels, columns


# ---------- 汇总 ----------

def 问题清单(report, expected_height):
    lines = []
    h = report["尺寸（米）"][2]
    if expected_height:
        diff = h - expected_height
        if abs(diff) > max(0.02, expected_height * 0.03):
            lines.append(f"高度 {h} 米，约定 {expected_height} 米，差 {round(diff, 3)} 米")
    if abs(report["最低点（米）"]) > 0.01:
        lines.append(f"最低点在 {report['最低点（米）']} 米，不在地面 0 上（站不住或陷进地里）")
    for o in report["原点"]:
        if o["离脚底中心（米）"] > max(0.05, h * 0.02):
            lines.append(f"{o['物体']} 的原点离脚底中心 {o['离脚底中心（米）']} 米")
    # 会出错的逐个部件列；开口边、没 UV 在拼出来的模型里很常见，合并成一句，举几个名字
    常见, 常见行 = ("开口边", "没有 UV"), []
    for p in report["网格问题"]:
        要紧 = [x for x in p["问题"] if not x.startswith(常见)]
        if 要紧:
            lines.append(f"{p['部件']}：{'；'.join(要紧)}")
    for 头 in 常见:
        有的 = [p["部件"] for p in report["网格问题"] if any(x.startswith(头) for x in p["问题"])]
        if 有的:
            说明 = "网格不封闭，有意做的薄片和两头开口的管子可以不管" if 头 == "开口边" else "要贴图的部件得先展 UV；只用纯色材质的不用管"
            常见行.append(f"{len(有的)}/{report['部件数']} 个部件{头}（{说明}），如 {'、'.join(有的[:5])}")
    for t in report["贴图"]:
        if not t["读到"]:
            lines.append(f"贴图 {t['名']} 没读到（多半是图片没跟模型放在一起）")
    for a in report["骨骼"]:
        if a["没有权重的顶点"]:
            lines.append(f"{a['骨架']}：蒙皮网格里有 {a['没有权重的顶点']} 个顶点没有权重，动起来会留在原地")
    for m in report["动作"]:
        if m["动了没有"] != "动了":
            lines.append(f"动作 {m['动作']} 没动：有动作数据，但取样时姿态不变")
        if m["最低点（米）"][0] < report["最低点（米）"] - 0.05:
            lines.append(f"动作 {m['动作']} 里最低点到 {m['最低点（米）'][0]} 米，比静止时低，会穿地")
    return lines + 常见行


def main():
    args = parse()
    model = Path(args.model).resolve()
    folder = Path(args.folder).resolve()
    if not model.is_file():
        raise FileNotFoundError(f"找不到模型文件：{model}")
    key = fingerprint(model, args)
    sheet, record = folder / f"体检-{key}.png", folder / f"体检-{key}.json"
    if record.is_file() and sheet.is_file() and not args.redo:
        report = json.loads(record.read_text(encoding="utf-8"))
        report["这次"] = "同一份文件体检过，直接用上次的结果（--重做 可重新渲染）"
        print("模型体检", json.dumps(report, ensure_ascii=False))
        return
    folder.mkdir(parents=True, exist_ok=True)
    meshes = 预览.load(model)
    scene = bpy.context.scene
    scene.frame_set(scene.frame_start)
    points = 预览.world_vertices(meshes)
    lo, hi = Vector(points.min(axis=0)), Vector(points.max(axis=0))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    report = {
        "文件": str(model), "指纹": key,
        "尺寸（米）": [round(v, 3) for v in (hi - lo)], "最低点（米）": round(lo.z, 3),
        "三角面": sum(三角面(o, depsgraph) for o in meshes), "顶点": sum(len(o.data.vertices) for o in meshes),
        "部件数": len(meshes), "部件（按面数）": 部件读数(meshes)[:15],
        "原点": 原点读数(lo, hi), "网格问题": 网格问题(meshes), "骨骼": 骨骼读数(meshes),
    }
    report["动作"] = 动作读数(meshes, scene)
    work = Path(tempfile.mkdtemp(prefix="blender-check-"))
    try:
        tiles, labels, columns = 画面(scene, meshes, points, lo, hi, work, args.size, report["动作"])
        report["贴图"] = 贴图读数()  # 渲染之后、拼图之前数：贴图这时才真正读过，联系表还没进来
        rows = 拼(tiles, sheet, args.size, columns)
        labelled = 写标签(sheet, labels, args.size, columns)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    report["联系表"] = str(sheet)
    report["联系表的格子"] = f"{columns} 列 × {rows} 行，从左到右、从上到下：" + "、".join(t for t in labels if t) + \
        ("" if labelled else "（这台机器缺 magick 或中文字体，格子上没写字，按这个顺序认）") + \
        "。方向按 Blender 算：glTF 的正面（+Z）导进来朝 -Y，正视那格看到的就是它；Godot 的正面是 -Z，导进 Blender 朝 +Y，要看背视那格"
    report["要看的"] = 问题清单(report, args.expected_height) or ["读数里没有发现问题；形和比例对不对，看联系表"]
    record.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print("模型体检", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
