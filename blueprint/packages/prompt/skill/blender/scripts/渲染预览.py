"""Import one 3D file in background Blender, frame it, render several angles into one PNG.

blender -b --factory-startup --python-exit-code 1 --python 渲染预览.py -- <模型> <输出.png> [--角度 4] [--边长 512]
"""
import argparse
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

IMPORTERS = {
    ".glb": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".fbx": lambda p: bpy.ops.import_scene.fbx(filepath=p),
    ".obj": lambda p: bpy.ops.wm.obj_import(filepath=p),
    ".stl": lambda p: bpy.ops.wm.stl_import(filepath=p),
    ".ply": lambda p: bpy.ops.wm.ply_import(filepath=p),
    ".usd": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".usda": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".usdc": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".usdz": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".abc": lambda p: bpy.ops.wm.alembic_import(filepath=p),
}


def parse():
    parser = argparse.ArgumentParser(prog="渲染预览.py")
    parser.add_argument("model")
    parser.add_argument("output")
    parser.add_argument("--角度", dest="angles", type=int, default=4)
    parser.add_argument("--边长", dest="size", type=int, default=512)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def load(model: Path):
    suffix = model.suffix.lower()
    if suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(model))
    elif suffix in IMPORTERS:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        IMPORTERS[suffix](str(model))
    else:
        raise ValueError(f"不认识的格式：{suffix}；能读 .blend {' '.join(IMPORTERS)}")
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.visible_get()]
    if not meshes:
        raise ValueError("文件里没有可见的网格")
    return meshes


def world_vertices(meshes):
    # 取求值后（骨骼、修改器生效）的顶点；物体自己的包围盒在旋转后会把尺寸算大
    depsgraph = bpy.context.evaluated_depsgraph_get()
    chunks = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
        evaluated.to_mesh_clear()
        matrix = np.array(evaluated.matrix_world, dtype=np.float64)
        chunks.append(co.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3])
    return np.concatenate(chunks)


def stage(scene, radius, size):
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 16
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("预览环境")
    world.color = (0.32, 0.33, 0.35)
    scene.world = world
    sun = bpy.data.objects.new("预览主光", bpy.data.lights.new("预览主光", "SUN"))
    sun.data.energy = 3.0
    scene.collection.objects.link(sun)
    camera = bpy.data.objects.new("预览镜头", bpy.data.cameras.new("预览镜头"))
    camera.data.lens = 50
    camera.data.clip_start = radius * 0.01
    camera.data.clip_end = radius * 100
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera, sun


def direction(azimuth, elevation):
    return Vector((math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation)))


def render_views(scene, camera, sun, center, points, angles, folder):
    half_view = 18 / camera.data.lens  # 36mm 底片、方形画面的半视角正切
    paths = []
    for index in range(angles):
        azimuth = 2 * math.pi * index / angles
        toward = direction(azimuth, math.radians(22))
        turn = (-toward).to_track_quat("-Z", "Y")
        right, up = turn @ Vector((1, 0, 0)), turn @ Vector((0, 1, 0))
        # 镜头退到每个顶点都落进画面为止，再留一点边
        offsets = points - np.array(center)
        sideways = np.maximum(np.abs(offsets @ np.array(right)), np.abs(offsets @ np.array(up)))
        distance = float(np.max(sideways / half_view + offsets @ np.array(toward)))
        camera.location = center + toward * distance * 1.06
        camera.rotation_euler = turn.to_euler()
        # 主光跟着镜头转，每张都是同样的前侧光
        sun.rotation_euler = (-direction(azimuth - math.radians(40), math.radians(50))).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(folder / f"view-{index}.png")
        bpy.ops.render.render(write_still=True)
        paths.append(scene.render.filepath)
    return paths


def stitch(paths, output: Path, size):
    columns = math.ceil(math.sqrt(len(paths)))
    rows = math.ceil(len(paths) / columns)
    sheet = np.ones((rows * size, columns * size, 4), dtype=np.float32)
    for index, path in enumerate(paths):
        image = bpy.data.images.load(path)
        pixels = np.empty(size * size * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        row = rows - 1 - index // columns  # Blender 像素从左下角开始
        column = index % columns
        sheet[row * size:(row + 1) * size, column * size:(column + 1) * size] = pixels.reshape(size, size, 4)
        bpy.data.images.remove(image)
    result = bpy.data.images.new("预览拼图", columns * size, rows * size, alpha=True)
    result.pixels.foreach_set(sheet.ravel())
    output.parent.mkdir(parents=True, exist_ok=True)
    result.filepath_raw = str(output)
    result.file_format = "PNG"
    result.save()
    return columns, rows


def summary(model, meshes, lo, hi):
    # 渲染之后再数：贴图这时才真正读过
    images = [i for i in bpy.data.images if i.source == "FILE"]
    return {
        "文件": str(model),
        "网格": len(meshes),
        "顶点": sum(len(o.data.vertices) for o in meshes),
        "面": sum(len(o.data.polygons) for o in meshes),
        "尺寸（米）": [round(v, 4) for v in (hi - lo)],
        "材质": sorted({s.material.name for o in meshes for s in o.material_slots if s.material}),
        "贴图": [{"名": i.name, "像素": list(i.size), "读到": bool(i.has_data and min(i.size) > 0)} for i in images],
        "骨架": len([o for o in bpy.context.scene.objects if o.type == "ARMATURE"]),
        "动作数": len(bpy.data.actions),
        "动作（前 20 个）": [{"名": a.name, "帧": [round(f, 2) for f in a.frame_range]} for a in list(bpy.data.actions)[:20]],
    }


def main():
    args = parse()
    model = Path(args.model).resolve()
    output = Path(args.output).resolve()
    if not model.is_file():
        raise FileNotFoundError(f"找不到模型文件：{model}")
    meshes = load(model)
    points = world_vertices(meshes)
    lo, hi = Vector(points.min(axis=0)), Vector(points.max(axis=0))
    center, radius = (lo + hi) / 2, max((hi - lo).length / 2, 1e-4)
    scene = bpy.context.scene
    camera, sun = stage(scene, radius, args.size)
    angles = max(1, args.angles)
    folder = Path(tempfile.mkdtemp(prefix="blender-preview-"))
    try:
        paths = render_views(scene, camera, sun, center, points, angles, folder)
        report = summary(model, meshes, lo, hi)
        columns, rows = stitch(paths, output, args.size)
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    report["预览"] = str(output)
    report["视角"] = f"{columns} 列 × {rows} 行，从左到右、从上到下；第一张从 -Y 看向 +Y（Blender 正视方向），之后每张绕竖轴转 {360 // angles}°，俯视 22°"
    print("模型概况", json.dumps(report, ensure_ascii=False))


# 模型体检.py 借用这里的读取与取顶点，直接跑才出预览图
if __name__ == "__main__":
    main()
