"""EEVEE previews and Cycles finals, with consistent photographic color management."""

import bpy
import os


def cycles_device(scene):
    """Prefer an available GPU; keep the exporter usable on CPU-only hosts."""
    scene.cycles.device = 'CPU'
    preferred = os.environ.get('VILLA_CYCLES_DEVICE', 'AUTO').upper()
    if preferred == 'CPU':
        return 'CPU'
    preferences = bpy.context.preferences.addons['cycles'].preferences
    for backend in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
        if preferred not in ('AUTO', backend):
            continue
        try:
            preferences.compute_device_type = backend
            preferences.get_devices()
            devices = [device for device in preferences.devices if device.type != 'CPU']
            if devices:
                for device in preferences.devices:
                    device.use = device.type != 'CPU'
                scene.cycles.device = 'GPU'
                return backend
        except (TypeError, RuntimeError):
            continue
    return 'CPU'


def configure_render(options, seed):
    scene = bpy.context.scene
    config = options["render"]
    scene.render.engine = "BLENDER_EEVEE_NEXT" if config["engine"] == "EEVEE" else "CYCLES"
    scene.render.resolution_x, scene.render.resolution_y = config["resolution"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -.3
    scene.view_settings.gamma = 1
    scene.cycles.samples = config["samples"]
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = .025 if config["quality"] == "preview" else .012
    scene.cycles.max_bounces, scene.cycles.transmission_bounces = 12, 8
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.seed = seed & 0x7fffffff
    device = cycles_device(scene) if config['engine'] == 'CYCLES' else 'EEVEE'
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = config["samples"]
        scene.eevee.use_raytracing = True
        if hasattr(scene.eevee, "use_fast_gi"):
            scene.eevee.use_fast_gi = True
    scene["visualization_engine"] = config["engine"]
    scene["visualization_quality"] = config["quality"]
    return {**config, "device": device, "colorTransform": "AgX", "exposure": -.3, "denoising": True}
