"""Interpret the existing planner's interleaved dog-leg nosing lines."""

from statistics import median


def stair_layout(stair):
    rect = stair["rect"]
    side = stair.get("startSide", "N")
    along_y = side in ("N", "S")
    across, run = (rect["w"], rect["h"]) if along_y else (rect["h"], rect["w"])

    def local(point):
        x, y = point["x"] - rect["x"], point["y"] - rect["y"]
        return {"N": (x, y), "S": (x, rect["h"] - y),
                "W": (y, x), "E": (y, rect["w"] - x)}[side]

    def world_rect(a, b, width, depth):
        if side == "N":
            return {"x": rect["x"] + a, "y": rect["y"] + b, "w": width, "h": depth}
        if side == "S":
            return {"x": rect["x"] + a, "y": rect["y"] + rect["h"] - b - depth, "w": width, "h": depth}
        if side == "W":
            return {"x": rect["x"] + b, "y": rect["y"] + a, "w": depth, "h": width}
        return {"x": rect["x"] + rect["w"] - b - depth, "y": rect["y"] + a, "w": depth, "h": width}

    flights = [[], []]
    for line in stair["treads"]:
        if len(line) < 2:
            raise ValueError(f"{stair['id']} has an invalid tread")
        a, b = local(line[0]), local(line[-1])
        if abs(a[1] - b[1]) > 2:
            raise ValueError(f"{stair['id']} tread is not across its flight")
        flight = 0 if (a[0] + b[0]) / 2 < across / 2 else 1
        flights[flight].append((min(a[0], b[0]), max(a[0], b[0]), a[1]))
    if not flights[0] or len(flights[0]) != len(flights[1]):
        raise ValueError(f"{stair['id']} needs two matching source flights")
    for flight in flights:
        flight.sort(key=lambda line: line[2])
    positions = [line[2] for line in flights[0]]
    going = median([positions[0], *[b - a for a, b in zip(positions, positions[1:])]])
    if going <= 0 or any(abs(b[2] - a[2]) > 2 for a, b in zip(*flights)):
        raise ValueError(f"{stair['id']} has inconsistent source nosings")
    travel = positions[-1] + going
    if run - travel < 500:
        raise ValueError(f"{stair['id']} has no usable turning landing")
    return {"flights": flights, "going": going, "travel": travel, "across": across,
            "run": run, "world_rect": world_rect, "steps_per_flight": len(positions) + 1,
            "opening": world_rect(0, going, across, run - going)}


def stair_opening(stair):
    # Retain the entrance-edge landing at the destination floor level.
    return stair_layout(stair)["opening"]
