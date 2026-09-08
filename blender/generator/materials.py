"""Preload the principled-BSDF materials for every slot so exports are stable."""

from __future__ import annotations

from .context import Spec, material

SLOTS = ("wall", "base", "trim", "roof", "frame", "accent", "glass", "floor", "ground")


def build(spec: Spec) -> None:
    for slot in SLOTS:
        material(slot, spec)
