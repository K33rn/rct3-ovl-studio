"""Blender: import each .glb given, frame it, render front 3/4 view to <glb>.png (workbench, textured)."""
import bpy, sys, os, math
from mathutils import Vector
files = sys.argv[sys.argv.index('--') + 1:]
for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = sc.render.resolution_y = 500
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.25, 0.27, 0.3)
    pts = [o.matrix_world @ Vector(c) for o in sc.objects if o.type == 'MESH' for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    c = (lo + hi) / 2; r = max((hi - lo).length / 2, 1e-3)
    cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = r * 2.2
    cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
    d = Vector((0.9, -1.4, 0.8)).normalized()      # Blender: -y is front
    cam.location = c + d * r * 6
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cd.clip_end = r * 20
    sc.render.filepath = f[:-4] + '.png'
    bpy.ops.render.render(write_still=True)
