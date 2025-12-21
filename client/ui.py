# client/ui.py
import pygame
import os
from .constants import *

# Global Assets & Fonts containers
assets = {}
font = None
font_big = None
font_small = None

def init_ui():
    """Khởi tạo font và load ảnh. Gọi hàm này sau khi pygame.init()"""
    global font, font_big, font_small
    font = pygame.font.SysFont('arial', 22, bold=True)
    font_big = pygame.font.SysFont('arial', 45, bold=True)
    font_small = pygame.font.SysFont('arial', 18, bold=True)
    load_assets()

def colorize_image(image, new_color):
    image = image.copy()
    w, h = image.get_size()
    for x in range(w):
        for y in range(h):
            r, g, b, a = image.get_at((x, y))
            if a > 0:
                image.set_at((x, y), (new_color[0], new_color[1], new_color[2], a))
    return image

def load_assets():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    assets_dir = os.path.join(base_dir, "assets")
    
    def create_fallback(w, h, color):
        s = pygame.Surface((w, h)); s.fill(color); pygame.draw.rect(s, WHITE, (0,0,w,h), 2)
        return s
    
    # Background
    path_bg = os.path.join(assets_dir, "ships", "background_battleship.png")
    if os.path.exists(path_bg):
        try: assets['bg'] = pygame.transform.scale(pygame.image.load(path_bg), (WIDTH, HEIGHT))
        except: assets['bg'] = None
    else: assets['bg'] = None 

    # Arrow
    path_arrow = os.path.join(assets_dir, "ships", "arrow.png")
    if os.path.exists(path_arrow):
        try: 
            img = pygame.image.load(path_arrow).convert_alpha()
            img = colorize_image(img, (255, 255, 255))
            assets['arrow'] = pygame.transform.scale(img, (60, 50))
        except: assets['arrow'] = None

    # Ships
    ship_sizes = [2, 3, 4, 5]
    for s in ship_sizes:
        pv = os.path.join(assets_dir, "ships", f"ship_{s}_v.png")
        ph = os.path.join(assets_dir, "ships", f"ship_{s}_h.png")
        if os.path.exists(pv): assets[f"{s}_v"] = pygame.transform.scale(pygame.image.load(pv), (GRID_SIZE, GRID_SIZE*s))
        else: assets[f"{s}_v"] = create_fallback(GRID_SIZE, GRID_SIZE*s, DARK_GRAY)
        if os.path.exists(ph): assets[f"{s}_h"] = pygame.transform.scale(pygame.image.load(ph), (GRID_SIZE*s, GRID_SIZE))
        else: assets[f"{s}_h"] = create_fallback(GRID_SIZE*s, GRID_SIZE, DARK_GRAY)

    # Icons
    path_explo = os.path.join(assets_dir, "ships", "explosion.png")
    path_splash = os.path.join(assets_dir, "ships", "splash.png")

    if os.path.exists(path_explo):
        assets['hit_img'] = pygame.transform.scale(pygame.image.load(path_explo).convert_alpha(), (GRID_SIZE, GRID_SIZE))
    
    if os.path.exists(path_splash):
        assets['miss_img'] = pygame.transform.scale(pygame.image.load(path_splash).convert_alpha(), (GRID_SIZE, GRID_SIZE))

    # Locks
    lock_closed = os.path.join(assets_dir, "ships", "lock_closed.png")
    if os.path.exists(lock_closed):
        assets['lock_closed'] = pygame.transform.scale(pygame.image.load(lock_closed).convert_alpha(), (30, 30))
    
    lock_open = os.path.join(assets_dir, "ships", "lock_open.png")
    if os.path.exists(lock_open):
        assets['lock_open'] = pygame.transform.scale(pygame.image.load(lock_open).convert_alpha(), (30, 30))

def draw_text_shadow(surface, text, font_obj, color, pos, center=False):
    shadow = font_obj.render(text, True, BLACK)
    shadow_rect = shadow.get_rect()
    txt = font_obj.render(text, True, color)
    txt_rect = txt.get_rect()
    
    if center:
        shadow_rect.center = (pos[0]+2, pos[1]+2)
        txt_rect.center = pos
    else:
        shadow_rect.topleft = (pos[0]+2, pos[1]+2)
        txt_rect.topleft = pos
        
    surface.blit(shadow, shadow_rect)
    surface.blit(txt, txt_rect)

def draw_button(screen, rect, text, hover=False):
    s = pygame.Surface((rect.width, rect.height), pygame.SRCALPHA)
    color = BUTTON_HOVER if hover else BUTTON_COLOR 
    pygame.draw.rect(s, color, s.get_rect(), border_radius=20)
    screen.blit(s, (rect.x, rect.y))
    pygame.draw.rect(screen, BLACK, rect, 2, border_radius=20)
    text_surf = font.render(text, True, BUTTON_TEXT_COLOR) 
    text_rect = text_surf.get_rect(center=(rect.centerx, rect.centery))
    screen.blit(text_surf, text_rect)

def draw_ship(screen, ship):
    key = f"{ship.size}_{ship.orient}"
    if key in assets:
        screen.blit(assets[key], (MY_BOARD_X + ship.x*GRID_SIZE, MARGIN_TOP + ship.y*GRID_SIZE))

def draw_menu(screen, input_room_id, show_input_bar, error_message):
    if assets.get('bg'): 
        screen.blit(assets['bg'], (0,0))
        s = pygame.Surface((WIDTH, HEIGHT)); s.set_alpha(100); s.fill((0,0,0)); screen.blit(s, (0,0))
    else: screen.fill(BLACK)

    draw_text_shadow(screen, "BATTLESHIP WARFARE", font_big, WHITE, (WIDTH//2, 80), center=True)
    
    mx, my = pygame.mouse.get_pos()
    
    btn_create = pygame.Rect(WIDTH//2 - 120, 200, 240, 50)
    draw_button(screen, btn_create, "CREATE ROOM", btn_create.collidepoint(mx, my))
    
    btn_random = pygame.Rect(WIDTH//2 - 120, 270, 240, 50)
    draw_button(screen, btn_random, "RANDOM MATCH", btn_random.collidepoint(mx, my))
    
    btn_join = pygame.Rect(WIDTH//2 - 120, 340, 240, 50)
    draw_button(screen, btn_join, "JOIN ROOM", btn_join.collidepoint(mx, my))
    
    if show_input_bar:
        input_rect = pygame.Rect(WIDTH//2 - 100, 410, 200, 40)
        pygame.draw.rect(screen, BLACK, input_rect, border_radius=10)
        pygame.draw.rect(screen, WHITE, input_rect, 2, border_radius=10)
        
        display_text = input_room_id if input_room_id else ""
        txt_surface = font.render(display_text, True, WHITE)
        txt_rect = txt_surface.get_rect(center=input_rect.center)
        screen.blit(txt_surface, txt_rect)
        
        hint = font_small.render("Enter ID & Press ENTER", True, WHITE)
        screen.blit(hint, (WIDTH//2 - hint.get_width()//2, 460))

    if error_message:
        err_surf = font_small.render(f"ERROR: {error_message}", True, WHITE)
        bg_rect = err_surf.get_rect(center=(WIDTH//2, 500))
        bg_rect.inflate_ip(30, 20)
        pygame.draw.rect(screen, RED, bg_rect, border_radius=10)
        pygame.draw.rect(screen, WHITE, bg_rect, 2, border_radius=10)
        screen.blit(err_surf, err_surf.get_rect(center=bg_rect.center))

    return btn_create, btn_random, btn_join

def draw_game_ui(screen, net, current_state, is_private_room, ships_to_place, current_ship_idx):
    if assets.get('bg'): 
        screen.blit(assets['bg'], (0, 0))
        overlay = pygame.Surface((WIDTH, HEIGHT)); overlay.set_alpha(120); overlay.fill(BLACK); screen.blit(overlay, (0,0))
    else: screen.fill(BLACK)

    if net.room_id:
        room_label = f"ROOM ID: {net.room_id}"
        font_room = pygame.font.SysFont('arial', 28, bold=True)
        room_surf = font_room.render(room_label, True, ORANGE)
        bg_w, bg_h = room_surf.get_width() + 100, room_surf.get_height() + 14
        bg_rect = pygame.Rect(0, 0, bg_w, bg_h)
        bg_rect.center = (WIDTH // 2, 40)
        
        pygame.draw.rect(screen, BLACK, bg_rect, border_radius=15)
        pygame.draw.rect(screen, WHITE, bg_rect, 2, border_radius=15)
        
        lock_img = assets.get('lock_closed') if is_private_room else assets.get('lock_open')
        if lock_img:
            screen.blit(lock_img, (bg_rect.left + 20, bg_rect.centery - lock_img.get_height() // 2))
        
        screen.blit(room_surf, room_surf.get_rect(center=bg_rect.center))

    status = ""
    color = WHITE
    if current_state == STATE_LOBBY:
        status = f"Waiting for opponent..."
        color = YELLOW
    elif current_state == STATE_SETUP:
        if current_ship_idx < len(ships_to_place):
            status = f"PLACE SHIP: Size {ships_to_place[current_ship_idx]} (R to rotate)"
        else:
            status = "Setting up..."
        color = GREEN
    elif current_state == STATE_WAIT_OPPONENT:
        status = "Ready! Waiting for opponent..."
        color = BLUE
    elif current_state == STATE_PLAYING:
        status = "YOUR TURN!" if net.turn == net.my_id else "OPPONENT'S TURN..."
        color = GREEN if net.turn == net.my_id else RED
            
    draw_text_shadow(screen, status, font, color, (WIDTH//2, HEIGHT - 40), center=True)

    back_btn_rect = pygame.Rect(20, 20, 60, 50) 
    if assets.get('arrow'): screen.blit(assets['arrow'], (20, 20))
    else:
        pygame.draw.circle(screen, DARK_GRAY, (45, 45), 25)
        pygame.draw.circle(screen, WHITE, (45, 45), 25, 2)
    return back_btn_rect

def draw_exit_popup(screen):
    overlay = pygame.Surface((WIDTH, HEIGHT)); overlay.set_alpha(150); overlay.fill(BLACK); screen.blit(overlay, (0,0))
    popup_rect = pygame.Rect(WIDTH//2 - 150, HEIGHT//2 - 100, 300, 200)
    pygame.draw.rect(screen, DARK_GRAY, popup_rect, border_radius=10)
    pygame.draw.rect(screen, WHITE, popup_rect, 2, border_radius=10)
    
    draw_text_shadow(screen, "DO YOU WANT TO QUIT?", font, WHITE, (WIDTH//2, HEIGHT//2 - 40), center=True)
    btn_yes = pygame.Rect(WIDTH//2 - 110, HEIGHT//2 + 20, 100, 50)
    draw_button(screen, btn_yes, "YES")
    btn_no = pygame.Rect(WIDTH//2 + 10, HEIGHT//2 + 20, 100, 50)
    draw_button(screen, btn_no, "NO")
    return btn_yes, btn_no

def draw_board_base(screen, start_x, start_y):
    grid_bg = pygame.Surface((BOARD_WIDTH_PX, BOARD_WIDTH_PX))
    grid_bg.fill(BLACK); grid_bg.set_alpha(150)
    screen.blit(grid_bg, (start_x, start_y))
    
    center_x = start_x + BOARD_WIDTH_PX // 2
    title = "MY FLEET" if start_x == MY_BOARD_X else "ENEMY WATERS"
    draw_text_shadow(screen, title, font, WHITE, (center_x, start_y - 30), center=True)

    for r in range(GRID_COUNT):
        for c in range(GRID_COUNT):
            rect = pygame.Rect(start_x + c*GRID_SIZE, start_y + r*GRID_SIZE, GRID_SIZE, GRID_SIZE)
            pygame.draw.rect(screen, GRID_LINE_COLOR, rect, 1, 5)

def draw_explosions_overlay(screen, board, start_x, start_y):
    for r in range(GRID_COUNT):
        for c in range(GRID_COUNT):
            rect = pygame.Rect(start_x + c*GRID_SIZE, start_y + r*GRID_SIZE, GRID_SIZE, GRID_SIZE)
            val = board[r][c]
            if val == 2: # MISS
                if 'miss_img' in assets: screen.blit(assets['miss_img'], (rect.x, rect.y))
                else: pygame.draw.circle(screen, BLUE, rect.center, GRID_SIZE//4) 
            elif val == 3: # HIT
                if 'hit_img' in assets: screen.blit(assets['hit_img'], (rect.x, rect.y))
                else: pygame.draw.circle(screen, RED, rect.center, GRID_SIZE//3)