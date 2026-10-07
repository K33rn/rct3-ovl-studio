"""Blender: import a morph-animated glb, play the action whose name contains <anim> on every mesh, render frames.
Args: -- glb anim out frac..."""
import bpy, sys
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
f, anim, out, fracs = a[0], a[1], a[2], [float(x) for x in a[3:]]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 400; sc.render.resolution_y = 500
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.25, 0.27, 0.3)
end = 1
for o in sc.objects:
    if o.type == 'MESH' and o.data.shape_keys:
        acts = [x for x in bpy.data.actions if anim.lower() in x.name.lower() and o.data.name.split('.')[0].lower() in x.name.lower()]
        acts = acts or [x for x in bpy.data.actions if anim.lower() in x.name.lower()]
        if not acts:
            continue
        sk = o.data.shape_keys; sk.animation_data_create(); sk.animation_data.action = acts[0]
        try:
            sk.animation_data.action_slot = acts[0].slots[0]
        except Exception:
            pass
        end = max(end, acts[0].frame_range[1])
pts = [o.matrix_world @ Vector(c) for o in sc.objects if o.type == 'MESH' for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
c = (lo + hi) / 2; r = (hi - lo).length / 2
cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = r * 2.2
cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = c + Vector((0.6, -1.4, 0.3)).normalized() * r * 6
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler(); cd.clip_end = r * 20
for i, fr in enumerate(fracs):
    sc.frame_set(int(end * fr))
    sc.render.filepath = f'{out}_{i}.png'; bpy.ops.render.render(write_still=True)
print('END', end)
