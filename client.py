import pygame
import socket
import threading
import json
import os
import sys

# --- 1. CẤU HÌNH MÀU SẮC ---
BLACK = (20, 20, 20)
WHITE = (255, 255, 255)
RED = (255, 50, 50)
GREEN = (50, 200, 50)
BLUE = (0, 120, 215)
YELLOW = (255, 255, 0)
ORANGE = (255, 165, 0)
DARK_GRAY = (50, 50, 50)

# --- MÀU LƯỚI ---
GRID_LINE_COLOR = WHITE 
# ----------------

BUTTON_COLOR = (225, 225, 225, 230)
BUTTON_HOVER = (200, 200, 255, 230)
BUTTON_TEXT_COLOR = (0, 0, 0)

# --- CẤU HÌNH GAME ---
SERVER_IP = '127.0.0.1'
PORT = 65432
GRID_SIZE = 40
GRID_COUNT = 10
MARGIN_TOP = 100
MARGIN_SIDE = 50
# ← THÊM HÀM NÀY NGAY Ở ĐÂY
def send_msg(conn, data):
    try:
        message = json.dumps(data).encode('utf-8')
        length = len(message)
        conn.sendall(length.to_bytes(4, 'big') + message)
    except Exception as e:
        print(f"[SERVER] Send error: {e}")
BOARD_WIDTH_PX = GRID_SIZE * GRID_COUNT
WIDTH = MARGIN_SIDE * 2 + BOARD_WIDTH_PX * 2 + 100
HEIGHT = MARGIN_TOP + BOARD_WIDTH_PX + 100

MY_BOARD_X = MARGIN_SIDE
ENEMY_BOARD_X = WIDTH - MARGIN_SIDE - BOARD_WIDTH_PX

pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Battleship V16 - Final Perfect")

font = pygame.font.SysFont('arial', 22, bold=True)
font_big = pygame.font.SysFont('arial', 45, bold=True)
font_small = pygame.font.SysFont('arial', 18, bold=True)

# --- BIẾN TOÀN CỤC ---
notification_text = ""  
notification_timer = 0 
notif_color = RED
total_hits_on_enemy = 0 

# --- LOAD ASSETS ---
assets = {}
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, "assets")

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
    def create_fallback(w, h, color):
        s = pygame.Surface((w, h)); s.fill(color); pygame.draw.rect(s, WHITE, (0,0,w,h), 2)
        return s
    
    # Background
    path_bg = os.path.join(ASSETS_DIR, "ships", "background_battleship.png")
    if os.path.exists(path_bg):
        try: assets['bg'] = pygame.transform.scale(pygame.image.load(path_bg), (WIDTH, HEIGHT))
        except: assets['bg'] = None
    else: assets['bg'] = None 

    # Arrow
    path_arrow = os.path.join(ASSETS_DIR, "ships", "arrow.png")
    if os.path.exists(path_arrow):
        try: 
            img = pygame.image.load(path_arrow).convert_alpha()
            img = colorize_image(img, (255, 255, 255))
            assets['arrow'] = pygame.transform.scale(img, (60, 50))
        except: assets['arrow'] = None
    else: assets['arrow'] = None

    # Ships
    ship_sizes = [2, 3, 4, 5]
    for s in ship_sizes:
        pv = os.path.join(ASSETS_DIR, "ships", f"ship_{s}_v.png")
        ph = os.path.join(ASSETS_DIR, "ships", f"ship_{s}_h.png")
        if os.path.exists(pv): assets[f"{s}_v"] = pygame.transform.scale(pygame.image.load(pv), (GRID_SIZE, GRID_SIZE*s))
        else: assets[f"{s}_v"] = create_fallback(GRID_SIZE, GRID_SIZE*s, DARK_GRAY)
        if os.path.exists(ph): assets[f"{s}_h"] = pygame.transform.scale(pygame.image.load(ph), (GRID_SIZE*s, GRID_SIZE))
        else: assets[f"{s}_h"] = create_fallback(GRID_SIZE*s, GRID_SIZE, DARK_GRAY)

    # Icons
    path_explo = os.path.join(ASSETS_DIR, "ships", "explosion.png")
    path_splash = os.path.join(ASSETS_DIR, "ships", "splash.png")

    if os.path.exists(path_explo):
        try:
            img = pygame.image.load(path_explo).convert_alpha()
            assets['hit'] = pygame.transform.scale(img, (GRID_SIZE, GRID_SIZE))
            assets['hit_img'] = assets['hit']
        except: 
            assets['hit'] = create_fallback(GRID_SIZE, GRID_SIZE, RED)
            assets['hit_img'] = assets['hit']
    else: 
        assets['hit'] = create_fallback(GRID_SIZE, GRID_SIZE, RED)
        assets['hit_img'] = assets['hit']

    if os.path.exists(path_splash):
        try:
            img = pygame.image.load(path_splash).convert_alpha()
            assets['miss'] = pygame.transform.scale(img, (GRID_SIZE, GRID_SIZE))
            assets['miss_img'] = assets['miss']
        except: 
            assets['miss'] = create_fallback(GRID_SIZE, GRID_SIZE, BLUE)
            assets['miss_img'] = assets['miss']
    else: 
        assets['miss'] = create_fallback(GRID_SIZE, GRID_SIZE, BLUE)
        assets['miss_img'] = assets['miss']

load_assets()

# --- NETWORK ---
class NetworkClient:
    def __init__(self):
        self.client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.client.settimeout(3)  # ← Timeout 3 giây
        self.connected = False
        self.my_id = None
        self.room_id = None
        self.turn = None
        self.msg_queue = []

    def connect(self):
        try:
            self.client.connect((SERVER_IP, PORT))
            self.client.settimeout(None)  # Tắt timeout sau khi kết nối thành công
            self.connected = True
            threading.Thread(target=self.receive_loop, daemon=True).start()
            return True
        except: return False

    def receive_loop(self):
        buffer = b''
        while self.connected:
            try:
                data = self.client.recv(4096)
                if not data:
                    break
                buffer += data

                while len(buffer) >= 4:
                    length = int.from_bytes(buffer[:4], 'big')
                    if len(buffer) >= 4 + length:
                        msg_data = buffer[4:4 + length]
                        buffer = buffer[4 + length:]

                        try:
                            msg = json.loads(msg_data.decode('utf-8'))
                            self.msg_queue.append(msg)
                        except:
                            pass  # JSON lỗi thì bỏ qua
                    else:
                        break  # Chưa đủ dữ liệu cho message tiếp theo
            except:
                self.connected = False
                break
    def send(self, data):
        if self.connected:
            try: 
                # Thay dòng này:
                # self.client.send(json.dumps(data).encode())
                # Thành:
                message = json.dumps(data).encode('utf-8')
                length = len(message)
                self.client.sendall(length.to_bytes(4, 'big') + message)
            except: 
                self.connected = False

net = NetworkClient()

# --- STATE MANAGEMENT ---
STATE_MENU = 0
STATE_LOBBY = 1
STATE_SETUP = 2
STATE_WAIT_OPPONENT = 3
STATE_PLAYING = 4
STATE_GAME_OVER = 5
STATE_CONFIRM_EXIT = 6
previous_state = STATE_MENU  # thêm dòng này
current_state = STATE_MENU
winner_id = None

# UI VARS
input_room_id = "" 
show_input_bar = False 
error_message = ""     

my_board = [[0]*GRID_COUNT for _ in range(GRID_COUNT)]
enemy_board = [[0]*GRID_COUNT for _ in range(GRID_COUNT)]
ships_to_place = [5, 4, 3, 3, 2]
placed_ships = []
current_ship_idx = 0
orientation = 'h'
23
class ShipObj:
    def __init__(self, size, x, y, orient):
        self.size = size; self.x = x; self.y = y; self.orient = orient
    def draw(self, surface):
        key = f"{self.size}_{self.orient}"
        if key in assets: surface.blit(assets[key], (MY_BOARD_X + self.x*GRID_SIZE, MARGIN_TOP + self.y*GRID_SIZE))

# --- UI FUNCTIONS ---

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

def is_ship_sunk(gx, gy):
    """Kiểm tra xem tàu tại vị trí (gx, gy) đã bị bắn nát hết chưa"""
    for ship in placed_ships:
        ship_cells = []
        if ship.orient == 'h':
            ship_cells = [(ship.x + i, ship.y) for i in range(ship.size)]
        else:
            ship_cells = [(ship.x, ship.y + i) for i in range(ship.size)]
        
        if (gx, gy) in ship_cells:
            for cx, cy in ship_cells:
                if my_board[cy][cx] != 3:
                    return False 
            return True 
    return False

def draw_button(rect, text, hover=False):
    s = pygame.Surface((rect.width, rect.height), pygame.SRCALPHA)
    color = BUTTON_HOVER if hover else BUTTON_COLOR 
    pygame.draw.rect(s, color, s.get_rect(), border_radius=20)
    screen.blit(s, (rect.x, rect.y))
    pygame.draw.rect(screen, BLACK, rect, 2, border_radius=20)
    text_surf = font.render(text, True, BUTTON_TEXT_COLOR) 
    text_rect = text_surf.get_rect(center=(rect.centerx, rect.centery))
    screen.blit(text_surf, text_rect)

def draw_menu():
    if assets.get('bg'): 
        screen.blit(assets['bg'], (0,0))
        s = pygame.Surface((WIDTH, HEIGHT)); s.set_alpha(100); s.fill((0,0,0)); screen.blit(s, (0,0))
    else: screen.fill(BLACK)

    draw_text_shadow(screen, "BATTLESHIP WARFARE", font_big, WHITE, (WIDTH//2, 80), center=True)
    
    mx, my = pygame.mouse.get_pos()
    
    btn_create = pygame.Rect(WIDTH//2 - 120, 200, 240, 50)
    draw_button(btn_create, "CREATE ROOM", btn_create.collidepoint(mx, my))
    
    btn_random = pygame.Rect(WIDTH//2 - 120, 270, 240, 50)
    draw_button(btn_random, "RANDOM MATCH", btn_random.collidepoint(mx, my))
    
    btn_join = pygame.Rect(WIDTH//2 - 120, 340, 240, 50)
    draw_button(btn_join, "JOIN ROOM", btn_join.collidepoint(mx, my))
    
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

def draw_game_ui():
    """Vẽ nền và UI chính (Header, Footer, Back Button)"""
    if assets.get('bg'): 
        screen.blit(assets['bg'], (0, 0))
        overlay = pygame.Surface((WIDTH, HEIGHT)); overlay.set_alpha(120); overlay.fill(BLACK); screen.blit(overlay, (0,0))
    else: screen.fill(BLACK)

    if net.room_id:
        room_label = f"ROOM ID: {net.room_id}"
        font_room = pygame.font.SysFont('arial', 28, bold=True)
        room_surf = font_room.render(room_label, True, ORANGE)
        bg_w = room_surf.get_width() + 40
        bg_h = room_surf.get_height() + 14
        bg_rect = pygame.Rect(0, 0, bg_w, bg_h)
        bg_rect.center = (WIDTH // 2, 40)
        pygame.draw.rect(screen, BLACK, bg_rect, border_radius=15)
        pygame.draw.rect(screen, WHITE, bg_rect, 2, border_radius=15)
        txt_rect = room_surf.get_rect(center=bg_rect.center)
        screen.blit(room_surf, txt_rect)

    status = ""
    color = WHITE
    if current_state == STATE_LOBBY:
        status = f"Waiting for opponent..."
        color = YELLOW
    elif current_state == STATE_SETUP:
        status = f"PLACE SHIP: Size {ships_to_place[current_ship_idx]} (R to rotate)"
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
        pygame.draw.polygon(screen, WHITE, [(55, 35), (35, 45), (55, 55)])
    
    # --- ĐÃ XÓA PHẦN VẼ POPUP Ở ĐÂY ĐỂ TRÁNH BỊ ĐÈ ---
    return back_btn_rect

def draw_exit_popup():
    """Hàm riêng để vẽ Popup, đảm bảo nằm trên cùng"""
    overlay = pygame.Surface((WIDTH, HEIGHT)); overlay.set_alpha(150); overlay.fill(BLACK); screen.blit(overlay, (0,0))
    popup_rect = pygame.Rect(WIDTH//2 - 150, HEIGHT//2 - 100, 300, 200)
    pygame.draw.rect(screen, DARK_GRAY, popup_rect, border_radius=10)
    pygame.draw.rect(screen, WHITE, popup_rect, 2, border_radius=10)
    
    draw_text_shadow(screen, "DO YOU WANT TO QUIT?", font, WHITE, (WIDTH//2, HEIGHT//2 - 40), center=True)
    btn_yes = pygame.Rect(WIDTH//2 - 110, HEIGHT//2 + 20, 100, 50)
    draw_button(btn_yes, "YES")
    btn_no = pygame.Rect(WIDTH//2 + 10, HEIGHT//2 + 20, 100, 50)
    draw_button(btn_no, "NO")
    return btn_yes, btn_no

def trigger_effect(text, color=RED):
    """Chỉ kích hoạt text"""
    global notification_text, notification_timer, notif_color
    notification_text = text
    notif_color = color
    notification_timer = 120 

def draw_board_base(screen, start_x, start_y):
    """Vẽ nền và lưới trước"""
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
    """Vẽ hiệu ứng Nổ/Trượt sau cùng để đè lên tàu"""
    for r in range(GRID_COUNT):
        for c in range(GRID_COUNT):
            rect = pygame.Rect(start_x + c*GRID_SIZE, start_y + r*GRID_SIZE, GRID_SIZE, GRID_SIZE)
            val = board[r][c]
            
            if val == 2: # MISS
                if 'miss_img' in assets:
                    screen.blit(assets['miss_img'], (rect.x, rect.y))
                else:
                    pygame.draw.circle(screen, BLUE, rect.center, GRID_SIZE//4) 
            
            elif val == 3: # HIT
                if 'hit_img' in assets:
                    screen.blit(assets['hit_img'], (rect.x, rect.y))
                else:
                    pygame.draw.circle(screen, RED, rect.center, GRID_SIZE//3) 

def main():
    global current_state, input_room_id, orientation, current_ship_idx, winner_id
    global show_input_bar, error_message, my_board, enemy_board, placed_ships
    global notification_timer, total_hits_on_enemy
    global notification_text, notif_color  # ← THÊM DÒNG NÀY
    
    
    show_input_bar = False
    input_room_id = ""
    total_hits_on_enemy = 0
    
    input_box_width = 240
    input_box_height = 40
    input_rect = pygame.Rect((WIDTH - input_box_width) // 2, 410, input_box_width, input_box_height)

    def reset_game():
        global my_board, enemy_board, placed_ships, current_ship_idx, total_hits_on_enemy
        my_board = [[0]*GRID_COUNT for _ in range(GRID_COUNT)]
        enemy_board = [[0]*GRID_COUNT for _ in range(GRID_COUNT)]
        placed_ships = []
        current_ship_idx = 0
        total_hits_on_enemy = 0

    if not net.connect():
        print("Cannot connect to Server!")
        return

    clock = pygame.time.Clock()
    running = True
    rect_yes, rect_no, rect_back = None, None, None
    btn_create, btn_rand, btn_join = None, None, None

    while running:
        while len(net.msg_queue) > 0:
            msg = net.msg_queue.pop(0)
            print(f"[DEBUG] Received message: {msg}")  # ← THÊM DÒNG NÀY
            action = msg.get('action')
            print(f"[DEBUG] Current state before handling: {current_state}")  # ← THÊM DÒNG NÀY
            
        
            if action == 'id': 
                net.my_id = msg['player_id']
                
            elif action == 'room_created':
                net.room_id = msg['room_id']
                current_state = STATE_LOBBY
                error_message = ""
                show_input_bar = False
                reset_game()
                
            elif action == 'match_found': 
                if 'room_id' in msg: 
                    net.room_id = msg['room_id']
                # ← QUAN TRỌNG: Ai nhận match_found cũng vào SETUP, kể cả người tạo phòng!
                current_state = STATE_SETUP
                error_message = ""
                show_input_bar = False
                reset_game()
                trigger_effect("OPPONENT FOUND!", GREEN)  # Thêm thông báo cho đẹp
                
            elif action == 'opponent_left':
                current_state = STATE_LOBBY
                reset_game()
                trigger_effect("OPPONENT LEFT THE GAME", RED)
                
            elif action == 'game_start':
                current_state = STATE_PLAYING
                net.turn = msg['turn']
                if net.turn == net.my_id:
                    trigger_effect("GAME START! YOUR TURN FIRST!", GREEN)
                else:
                    trigger_effect("GAME START! OPPONENT'S TURN", YELLOW)
            # ← XỬ LÝ BẮN MỚI - CHỈ DỰA VÀO update_board TỪ SERVER
            elif action == 'update_board':
                x = msg['x']
                y = msg['y']
                status = msg['status']
                shooter = msg['shooter']
                net.turn = msg['turn']
                
                if shooter == net.my_id:
                    # Mình là người bắn → cập nhật bảng enemy
                    enemy_board[y][x] = 3 if status in ['hit', 'sunk'] else 2
                    if status in ['hit', 'sunk']:
                        total_hits_on_enemy += 1
                        if status == 'sunk' and total_hits_on_enemy < 17:
                            trigger_effect("SHIP SUNK!", YELLOW)
                else:
                    # Đối thủ bắn → cập nhật bảng mình
                    my_board[y][x] = 3 if status in ['hit', 'sunk'] else 2

            elif action == 'game_over':
                winner_id = msg['winner']
                current_state = STATE_GAME_OVER
                if winner_id == net.my_id:
                    trigger_effect("YOU WIN!", GREEN)
                else:
                    trigger_effect("YOU LOSE!", RED)
                    
            elif action == 'error': 
                error_message = msg['msg']
                trigger_effect(f"ERROR: {error_message}", RED)

            # === KHÔNG CÒN screen.fill(BLACK) Ở ĐÂY NỮA ===

        rect_yes, rect_no, rect_back = None, None, None
        btn_create, btn_rand, btn_join = None, None, None

        # VẼ MÀN HÌNH THEO STATE
        if current_state == STATE_MENU:
            # Vẽ menu với background đẹp
            if assets.get('bg'):
                screen.blit(assets['bg'], (0, 0))
                overlay = pygame.Surface((WIDTH, HEIGHT))
                overlay.set_alpha(100)
                overlay.fill((0, 0, 0))
                screen.blit(overlay, (0, 0))
            else:
                screen.fill(BLACK)
            btn_create, btn_rand, btn_join = draw_menu()

        elif current_state == STATE_GAME_OVER:
            # Vẽ màn hình thắng/thua
            if assets.get('bg'):
                screen.blit(assets['bg'], (0, 0))
                overlay = pygame.Surface((WIDTH, HEIGHT))
                overlay.set_alpha(120)
                overlay.fill(BLACK)
                screen.blit(overlay, (0, 0))
            else:
                screen.fill(BLACK)
            draw_game_ui()
            overlay = pygame.Surface((WIDTH, HEIGHT))
            overlay.set_alpha(200)
            overlay.fill(BLACK)
            screen.blit(overlay, (0, 0))

            is_winner = (winner_id == net.my_id)
            res_txt = "YOU WIN!" if is_winner else "YOU LOSE!"
            col = GREEN if is_winner else RED
            draw_text_shadow(screen, res_txt, font_big, col, (WIDTH//2, HEIGHT//2), center=True)

            rect_back = pygame.Rect(WIDTH//2 - 50, HEIGHT//2 + 60, 100, 40)
            draw_button(rect_back, "EXIT")

        else:
            # Các state chơi game: LOBBY, SETUP, WAIT_OPPONENT, PLAYING, CONFIRM_EXIT
            if assets.get('bg'):
                screen.blit(assets['bg'], (0, 0))
                overlay = pygame.Surface((WIDTH, HEIGHT))
                overlay.set_alpha(120)
                overlay.fill(BLACK)
                screen.blit(overlay, (0, 0))
            else:
                screen.fill(BLACK)

            rect_back = draw_game_ui()
            draw_board_base(screen, MY_BOARD_X, MARGIN_TOP)
            draw_board_base(screen, ENEMY_BOARD_X, MARGIN_TOP)

            for s in placed_ships:
                s.draw(screen)

            draw_explosions_overlay(screen, my_board, MY_BOARD_X, MARGIN_TOP)
            draw_explosions_overlay(screen, enemy_board, ENEMY_BOARD_X, MARGIN_TOP)

            mx, my = pygame.mouse.get_pos()
            if current_state == STATE_SETUP and current_ship_idx < len(ships_to_place):
                if MY_BOARD_X < mx < MY_BOARD_X + BOARD_WIDTH_PX and MARGIN_TOP < my < MARGIN_TOP + BOARD_WIDTH_PX:
                    gx, gy = (mx - MY_BOARD_X)//GRID_SIZE, (my - MARGIN_TOP)//GRID_SIZE
                    key = f"{ships_to_place[current_ship_idx]}_{orientation}"
                    if key in assets:
                        ghost = assets[key].copy()
                        ghost.set_alpha(150)
                        screen.blit(ghost, (MY_BOARD_X + gx*GRID_SIZE, MARGIN_TOP + gy*GRID_SIZE))

            if current_state == STATE_CONFIRM_EXIT:
                rect_yes, rect_no = draw_exit_popup()

        # DRAW NOTIFICATION
        if notification_timer > 0 and current_state == STATE_PLAYING:
            notif_surf = font_big.render(notification_text, True, notif_color)
            notif_rect = notif_surf.get_rect(center=(WIDTH//2, HEIGHT//2))
            shadow_surf = font_big.render(notification_text, True, BLACK)
            screen.blit(shadow_surf, (notif_rect.x + 3, notif_rect.y + 3))
            screen.blit(notif_surf, notif_rect)
            notification_timer -= 1

        # XỬ LÝ EVENT
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
                pygame.quit()
                return

            if event.type == pygame.MOUSEBUTTONDOWN:
                mx, my = pygame.mouse.get_pos()

                # XỬ LÝ POPUP THOÁT TRƯỚC (VÌ NÓ ĐÈ LÊN TẤT CẢ)
                if current_state == STATE_CONFIRM_EXIT:
                    if rect_yes and rect_yes.collidepoint(mx, my):
                        net.send({"action": "leave_room"})
                        current_state = STATE_MENU
                        net.room_id = None
                        reset_game()
                        show_input_bar = False
                        error_message = ""
                        notification_text = ""
                        notification_timer = 0
                        total_hits_on_enemy = 0
                    elif rect_no and rect_no.collidepoint(mx, my):
                        current_state = previous_state  # Quay lại trạng thái trước đó
                    # Click ngoài popup thì giữ nguyên popup (không đóng)
                    

                # XỬ LÝ NÚT BACK (CHỈ HIỆN Ở CÁC STATE CHƠI GAME)
                if current_state not in [STATE_MENU, STATE_GAME_OVER, STATE_CONFIRM_EXIT]:
                    if rect_back and rect_back.collidepoint(mx, my):
                        previous_state = current_state
                        current_state = STATE_CONFIRM_EXIT
                        continue

                # XỬ LÝ NÚT EXIT Ở MÀN HÌNH GAME OVER
                if current_state == STATE_GAME_OVER:
                    if rect_back and rect_back.collidepoint(mx, my):
                        net.send({"action": "leave_room"})
                        current_state = STATE_MENU
                        net.room_id = None
                        reset_game()
                        winner_id = None  # ← THÊM DÒNG DUY NHẤT NÀY
                        continue

                # XỬ LÝ MENU CHÍNH
                if current_state == STATE_MENU:
                    if btn_create and btn_create.collidepoint(mx, my):
                        net.send({"action": "create_room"})
                        show_input_bar = False
                    elif btn_rand and btn_rand.collidepoint(mx, my):
                        net.send({"action": "random_match"})
                        show_input_bar = False
                    elif btn_join and btn_join.collidepoint(mx, my):
                        if not show_input_bar:
                            show_input_bar = True
                            input_room_id = ""
                            error_message = ""
                        else:
                            error_message = ""
                    elif show_input_bar and not input_rect.collidepoint(mx, my):
                        show_input_bar = False

                # XỬ LÝ ĐẶT TÀU
                elif current_state == STATE_SETUP:
                    if MY_BOARD_X < mx < MY_BOARD_X + BOARD_WIDTH_PX and MARGIN_TOP < my < MARGIN_TOP + BOARD_WIDTH_PX:
                        gx, gy = (mx - MY_BOARD_X) // GRID_SIZE, (my - MARGIN_TOP) // GRID_SIZE
                        size = ships_to_place[current_ship_idx]
                        valid = True
                        cells_to_check = []
                        if orientation == 'h':
                            if gx + size > 10:
                                valid = False
                            else:
                                cells_to_check = [(gx + k, gy) for k in range(size)]
                        else:
                            if gy + size > 10:
                                valid = False
                            else:
                                cells_to_check = [(gx, gy + k) for k in range(size)]
                        if valid and any(my_board[y][x] == 1 for x, y in cells_to_check):
                            valid = False
                        if valid:
                            placed_ships.append(ShipObj(size, gx, gy, orientation))
                            for x, y in cells_to_check:
                                my_board[y][x] = 1
                            current_ship_idx += 1
                            if current_ship_idx >= len(ships_to_place):
                                ships_data = []
                                for ship in placed_ships:
                                    cells = []
                                    if ship.orient == 'h':
                                        for i in range(ship.size):
                                            cells.append([ship.x + i, ship.y])
                                    else:
                                        for i in range(ship.size):
                                            cells.append([ship.x, ship.y + i])
                                    ships_data.append({"cells": cells})
                                net.send({"action": "ready", "ships": ships_data})
                                current_state = STATE_WAIT_OPPONENT
                                trigger_effect("READY! Waiting for opponent...", BLUE)

                # XỬ LÝ BẮN
                elif current_state == STATE_PLAYING and net.turn == net.my_id:
                    if ENEMY_BOARD_X < mx < ENEMY_BOARD_X + BOARD_WIDTH_PX and MARGIN_TOP < my < MARGIN_TOP + BOARD_WIDTH_PX:
                        gx, gy = (mx - ENEMY_BOARD_X) // GRID_SIZE, (my - MARGIN_TOP) // GRID_SIZE
                        if enemy_board[gy][gx] == 0:
                            net.send({"action": "fire", "x": gx, "y": gy})

            if event.type == pygame.KEYDOWN:
                if current_state == STATE_MENU and show_input_bar:
                    if event.key == pygame.K_BACKSPACE:
                        input_room_id = input_room_id[:-1]
                        error_message = ""
                    elif event.key == pygame.K_RETURN and len(input_room_id) > 0:
                        net.send({"action": "join_room", "room_id": input_room_id})
                    elif event.unicode.isnumeric() and len(input_room_id) < 4:
                        input_room_id += event.unicode
                        error_message = ""
                elif current_state == STATE_SETUP:
                    if event.key == pygame.K_r:
                        orientation = 'v' if orientation == 'h' else 'h'

        pygame.display.flip()
        clock.tick(60)

if __name__ == "__main__":
    main()