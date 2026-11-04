import os
from PIL import Image, ImageDraw, ImageFont

def create_floor_plan():
    # Image dimensions (high-res 1600 x 1400 px)
    width = 1600
    height = 1400
    
    # 1. Background: Warm architectural draft paper with subtle grid
    img = Image.new("RGB", (width, height), (252, 251, 249))
    draw = ImageDraw.Draw(img)
    
    # Draw faint drafting grid (every 40 px)
    grid_color = (235, 233, 228)
    for x in range(0, width, 40):
        draw.line([(x, 0), (x, height)], fill=grid_color, width=1)
    for y in range(0, height, 40):
        draw.line([(0, y), (width, y)], fill=grid_color, width=1)
        
    # Dark charcoal ink color for architectural walls
    wall_color = (28, 28, 30)
    wall_fill = (45, 45, 48)
    wall_inner_fill = (248, 247, 244)
    line_dim_color = (80, 80, 85)
    accent_blue = (20, 90, 160)
    
    # Font fallbacks
    try:
        font_title = ImageFont.truetype("arial.ttf", 24)
        font_room = ImageFont.truetype("arial.ttf", 20)
        font_dim = ImageFont.truetype("arial.ttf", 15)
        font_sub = ImageFont.truetype("arial.ttf", 13)
    except:
        font_title = font_room = font_dim = font_sub = ImageFont.load_default()

    # Building bounds in pixels
    # Width: 880 px (approx 11 m / 36 ft)
    # Height: 960 px (approx 12 m / 40 ft)
    bx = 360
    by = 220
    bw = 880
    bh = 960
    
    # Outer double line wall (230 mm = approx 16 px)
    t_ext = 16
    t_int = 8
    
    # Draw outer perimeter wall
    draw.rectangle([bx - t_ext, by - t_ext, bx + bw + t_ext, by + bh + t_ext], fill=wall_fill, outline=wall_color, width=2)
    draw.rectangle([bx, by, bx + bw, by + bh], fill=wall_inner_fill)
    
    # Internal layout partitioning:
    # ----------------------------------------------------
    # Top Row: Master Bed (left), Common Bath (mid-left), Bed 2 (right)
    # Mid Row: Pooja & Kitchen (right), Living/Dining (left to center)
    # Bottom Row: Entry Verandah & Foyer
    # ----------------------------------------------------
    
    # Y division 1: Top rooms end at y = 420 px from top of building (by + 420)
    y_top = by + 420
    # Y division 2: Living/Kitchen split at y = by + 760
    y_mid = by + 760
    
    # X division 1: Master Bed width = 460 px
    x_mbed = bx + 460
    # X division 2: Bath width = 160 px (x_mbed + 160 = bx + 620)
    x_bath = bx + 620
    # X division 3: Kitchen width = 360 px (from right: bx + 520)
    x_kitch = bx + 520
    
    # DRAW INTERNAL PARTITIONS (with thickness)
    
    # 1. Horizontal wall below bedrooms: x: bx to bx + bw, at y_top
    draw.rectangle([bx, y_top - t_int//2, bx + bw, y_top + t_int//2], fill=wall_fill, outline=wall_color)
    
    # 2. Vertical wall between Master Bed and Bath
    draw.rectangle([x_mbed - t_int//2, by, x_mbed + t_int//2, y_top], fill=wall_fill, outline=wall_color)
    
    # 3. Vertical wall between Bath and Bedroom 2
    draw.rectangle([x_bath - t_int//2, by, x_bath + t_int//2, y_top], fill=wall_fill, outline=wall_color)
    
    # 4. Master Bed Attached Toilet wall (inside Master Bed top-left corner: w=180, h=160)
    m_bath_w = 180
    m_bath_h = 160
    draw.rectangle([bx, by + m_bath_h - t_int//2, bx + m_bath_w, by + m_bath_h + t_int//2], fill=wall_fill, outline=wall_color)
    draw.rectangle([bx + m_bath_w - t_int//2, by, bx + m_bath_w + t_int//2, by + m_bath_h], fill=wall_fill, outline=wall_color)
    
    # 5. Vertical wall separating Living and Kitchen/Pooja on middle level
    draw.rectangle([x_kitch - t_int//2, y_top, x_kitch + t_int//2, by + bh], fill=wall_fill, outline=wall_color)
    
    # 6. Horizontal wall separating Pooja and Kitchen: y = by + 560
    y_pooja = by + 560
    draw.rectangle([x_kitch, y_pooja - t_int//2, bx + bw, y_pooja + t_int//2], fill=wall_fill, outline=wall_color)
    
    # 7. Entrance Foyer / Verandah partition at bottom left
    x_foyer = bx + 360
    y_foyer = by + bh - 160
    draw.rectangle([bx, y_foyer - t_int//2, x_foyer, y_foyer + t_int//2], fill=wall_fill, outline=wall_color)
    draw.rectangle([x_foyer - t_int//2, y_foyer, x_foyer + t_int//2, by + bh], fill=wall_fill, outline=wall_color)

    # ----------------------------------------------------
    # DOORS & SWING ARCS (clean architectural openings)
    # ----------------------------------------------------
    def draw_door(cx, cy, dw, angle_start, angle_end, orientation="h"):
        # Clear wall gap
        if orientation == "h":
            draw.rectangle([cx, cy - t_int, cx + dw, cy + t_int], fill=wall_inner_fill)
            # Door leaf
            draw.line([(cx, cy), (cx, cy - dw)], fill=wall_color, width=2)
            # Swing arc
            draw.arc([cx - dw, cy - dw, cx + dw, cy + dw], start=270, end=360, fill=accent_blue, width=1)
        else:
            draw.rectangle([cx - t_int, cy, cx + t_int, cy + dw], fill=wall_inner_fill)
            draw.line([(cx, cy), (cx + dw, cy)], fill=wall_color, width=2)
            draw.arc([cx - dw, cy - dw, cx + dw, cy + dw], start=0, end=90, fill=accent_blue, width=1)

    # Main Entry Door (1200 mm = 70 px) at Entrance Verandah
    draw.rectangle([bx + 80, by + bh - t_ext - 2, bx + 160, by + bh + 4], fill=wall_inner_fill)
    draw.line([(bx + 80, by + bh - t_ext), (bx + 80, by + bh - t_ext - 80)], fill=wall_color, width=3)
    draw.arc([bx, by + bh - t_ext - 80, bx + 160, by + bh - t_ext + 80], start=270, end=360, fill=accent_blue, width=2)

    # Living to Foyer inner door
    draw_door(bx + 140, y_foyer, 60, 270, 360, "h")
    # Master Bedroom Door
    draw_door(x_mbed - 70, y_top, 60, 270, 360, "h")
    # Bedroom 2 Door
    draw_door(x_bath + 20, y_top, 60, 270, 360, "h")
    # Kitchen Door
    draw_door(x_kitch, y_pooja + 30, 60, 0, 90, "v")
    # Common Bath Door
    draw_door(x_mbed + 20, y_top, 50, 270, 360, "h")

    # ----------------------------------------------------
    # WINDOWS (3 parallel lines on exterior walls)
    # ----------------------------------------------------
    def draw_window_h(wx, wy, ww):
        draw.rectangle([wx, wy - t_ext, wx + ww, wy], fill=wall_inner_fill)
        draw.line([(wx, wy - t_ext), (wx + ww, wy - t_ext)], fill=wall_color, width=2)
        draw.line([(wx, wy - t_ext//2), (wx + ww, wy - t_ext//2)], fill=(120, 150, 180), width=2)
        draw.line([(wx, wy), (wx + ww, wy)], fill=wall_color, width=2)

    def draw_window_v(wx, wy, wh):
        draw.rectangle([wx, wy, wx + t_ext, wy + wh], fill=wall_inner_fill)
        draw.line([(wx, wy), (wx, wy + wh)], fill=wall_color, width=2)
        draw.line([(wx + t_ext//2, wy), (wx + t_ext//2, wy + wh)], fill=(120, 150, 180), width=2)
        draw.line([(wx + t_ext, wy), (wx + t_ext, wy + wh)], fill=wall_color, width=2)

    # Living Room Windows (left wall & bottom wall)
    draw_window_v(bx - t_ext, by + 500, 120)
    # Master Bed Window (top wall & left wall)
    draw_window_h(bx + 240, by, 100)
    # Bedroom 2 Window (top wall & right wall)
    draw_window_h(bx + 680, by, 100)
    draw_window_v(bx + bw, by + 160, 100)
    # Kitchen Window (right wall)
    draw_window_v(bx + bw, by + 620, 90)

    # ----------------------------------------------------
    # ROOM LABELS & SIZES
    # ----------------------------------------------------
    rooms_data = [
        ("LIVING & DINING", "17'-6\" X 14'-0\"", bx + 240, by + 580),
        ("MASTER BEDROOM", "14'-0\" X 12'-0\"", bx + 220, by + 230),
        ("BEDROOM 2", "12'-0\" X 11'-6\"", bx + 740, by + 230),
        ("KITCHEN", "10'-0\" X 11'-0\"", bx + 690, by + 650),
        ("POOJA", "5'-6\" X 5'-0\"", bx + 690, by + 480),
        ("TOILET", "7'-0\" X 4'-6\"", bx + 540, by + 230),
        ("M. BATH", "6'-0\" X 5'-0\"", bx + 90, by + 90),
        ("VERANDAH / ENTRY", "11'-0\" X 5'-0\"", bx + 170, by + bh - 80),
    ]

    for title, dim, rx, ry in rooms_data:
        draw.text((rx, ry), title, fill=(20, 20, 25), font=font_room, anchor="mm")
        draw.text((rx, ry + 22), dim, fill=(100, 100, 110), font=font_dim, anchor="mm")

    # ----------------------------------------------------
    # EXTERIOR DIMENSION LINES & TICK MARKS
    # ----------------------------------------------------
    # Top Dimension (Overall Width: 32' 0" / 9.75 m)
    dim_y = by - 80
    draw.line([(bx, dim_y), (bx + bw, dim_y)], fill=line_dim_color, width=2)
    draw.line([(bx, dim_y - 12), (bx, dim_y + 12)], fill=line_dim_color, width=2)
    draw.line([(bx + bw, dim_y - 12), (bx + bw, dim_y + 12)], fill=line_dim_color, width=2)
    # Dimension witness projection lines
    draw.line([(bx, by - t_ext - 10), (bx, dim_y - 16)], fill=(180, 180, 185), width=1)
    draw.line([(bx + bw, by - t_ext - 10), (bx + bw, dim_y - 16)], fill=(180, 180, 185), width=1)
    draw.text((bx + bw // 2, dim_y - 18), "32'-0\" (9.75 M)", fill=line_dim_color, font=font_dim, anchor="mm")

    # Left Dimension (Overall Depth: 35' 0" / 10.65 m)
    dim_x = bx - 100
    draw.line([(dim_x, by), (dim_x, by + bh)], fill=line_dim_color, width=2)
    draw.line([(dim_x - 12, by), (dim_x + 12, by)], fill=line_dim_color, width=2)
    draw.line([(dim_x - 12, by + bh), (dim_x + 12, by + bh)], fill=line_dim_color, width=2)
    draw.line([(bx - t_ext - 10, by), (dim_x - 16, by)], fill=(180, 180, 185), width=1)
    draw.line([(bx - t_ext - 10, by + bh), (dim_x - 16, by + bh)], fill=(180, 180, 185), width=1)
    draw.text((dim_x - 18, by + bh // 2), "35'-0\" (10.65 M)", fill=line_dim_color, font=font_dim, anchor="rm")

    # ----------------------------------------------------
    # TITLE BLOCK (Professional Architectural Header & Stamp)
    # ----------------------------------------------------
    tb_x = 900
    tb_y = height - 160
    draw.rectangle([tb_x, tb_y, width - 60, height - 40], fill=(255, 255, 255), outline=wall_color, width=2)
    draw.line([(tb_x, tb_y + 35), (width - 60, tb_y + 35)], fill=wall_color, width=1)
    draw.line([(tb_x + 280, tb_y), (tb_x + 280, height - 40)], fill=wall_color, width=1)

    draw.text((tb_x + 140, tb_y + 18), "BRICKPILOT ARCHITECTURE", fill=wall_color, font=font_dim, anchor="mm")
    draw.text((tb_x + 140, tb_y + 60), "PROJECT: 3-BHK VILLA", fill=wall_color, font=font_room, anchor="mm")
    draw.text((tb_x + 140, tb_y + 90), "GROUND FLOOR PLAN", fill=(80, 80, 85), font=font_dim, anchor="mm")

    draw.text((tb_x + 380, tb_y + 18), "SPECIFICATION", fill=wall_color, font=font_dim, anchor="mm")
    draw.text((tb_x + 380, tb_y + 55), "SCALE : 1:100", fill=(80, 80, 85), font=font_sub, anchor="mm")
    draw.text((tb_x + 380, tb_y + 75), "DATE  : NOVEMBER 2026", fill=(80, 80, 85), font=font_sub, anchor="mm")
    draw.text((tb_x + 380, tb_y + 95), "SHEET : A-101", fill=(80, 80, 85), font=font_sub, anchor="mm")

    # NORTH ARROW at top right
    nx = width - 140
    ny = 120
    draw.polygon([(nx, ny - 45), (nx - 18, ny + 20), (nx, ny + 10)], fill=wall_color)
    draw.polygon([(nx, ny - 45), (nx + 18, ny + 20), (nx, ny + 10)], fill=(200, 200, 205), outline=wall_color)
    draw.text((nx, ny - 60), "N", fill=wall_color, font=font_title, anchor="mm")

    # Save to public and test locations
    os.makedirs("public/sample-plans", exist_ok=True)
    out_path = "public/sample-plans/sample-2d-villa-plan.png"
    img.save(out_path, "PNG", quality=95)
    print(f"Sample plan successfully generated at: {out_path}")

if __name__ == "__main__":
    create_floor_plan()

