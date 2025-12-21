# client/main.py
import pygame
import sys
import os

# Import modules
from client.constants import *
from client.network import NetworkClient
from client.game_logic import ShipObj, check_valid_placement, reset_board
import client.ui as ui

# Khởi tạo Pygame
pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Battleship V16 - Modular Client")

# Khởi tạo tài nguyên UI (font, ảnh)
ui.init_ui()

# --- BIẾN TOÀN CỤC ---
net = NetworkClient()
current_state = STATE_MENU
previous_state = STATE_MENU

my_board = reset_board()
enemy_board = reset_board()
placed_ships = []
ships_to_place = [5, 4, 3, 3, 2]
current_ship_idx = 0
orientation = 'h'

notification_text = ""
notification_timer = 0
notif_color = RED
total_hits_on_enemy = 0
is_private_room = False
winner_id = None

# UI vars
input_room_id = ""
show_input_bar = False
error_message = ""

def trigger_effect(text, color=RED):
    global notification_text, notification_timer, notif_color
    notification_text = text
    notif_color = color
    notification_timer = 120 

def reset_game_state():
    global my_board, enemy_board, placed_ships, current_ship_idx, total_hits_on_enemy
    my_board = reset_board()
    enemy_board = reset_board()
    placed_ships = []
    current_ship_idx = 0
    total_hits_on_enemy = 0

def main():
    global current_state, previous_state, is_private_room, show_input_bar, input_room_id, error_message, winner_id
    global orientation, current_ship_idx, total_hits_on_enemy
    global notification_text, notification_timer, notif_color
    if not net.connect():
        print("Cannot connect to Server!")
        return

    clock = pygame.time.Clock()
    running = True

    while running:
        # --- NETWORK HANDLER ---
        while len(net.msg_queue) > 0:
            msg = net.msg_queue.pop(0)
            action = msg.get('action')
            print(f"[DEBUG] Msg: {msg}")

            if action == 'id':
                net.my_id = msg['player_id']
            
            elif action == 'room_created':
                net.room_id = msg['room_id']
                current_state = STATE_LOBBY
                reset_game_state()
            
            elif action == 'match_found':
                if 'room_id' in msg: net.room_id = msg['room_id']
                current_state = STATE_SETUP
                reset_game_state()
                trigger_effect("OPPONENT FOUND!", GREEN)
            
            elif action == 'opponent_left':
                current_state = STATE_LOBBY
                reset_game_state()
                trigger_effect("OPPONENT LEFT", RED)
            
            elif action == 'game_start':
                current_state = STATE_PLAYING
                net.turn = msg['turn']
                if net.turn == net.my_id: trigger_effect("GAME START! YOUR TURN!", GREEN)
                else: trigger_effect("GAME START! WAIT...", YELLOW)
            
            elif action == 'update_board':
                x, y = msg['x'], msg['y']
                status = msg['status']
                shooter = msg['shooter']
                net.turn = msg['turn']
                
                if shooter == net.my_id:
                    enemy_board[y][x] = 3 if status in ['hit', 'sunk'] else 2
                    if status in ['hit', 'sunk']:
                        total_hits_on_enemy += 1
                        if status == 'sunk' and total_hits_on_enemy < 17:
                            trigger_effect("SHIP SUNK!", YELLOW)
                else:
                    my_board[y][x] = 3 if status in ['hit', 'sunk'] else 2
            
            elif action == 'game_over':
                winner_id = msg['winner']
                current_state = STATE_GAME_OVER
            
            elif action == 'error':
                error_message = msg['msg']
                trigger_effect(f"ERR: {error_message}", RED)

        # --- DRAWING ---
        rect_yes, rect_no, rect_back = None, None, None
        btn_create, btn_rand, btn_join = None, None, None
        input_rect = pygame.Rect(WIDTH//2 - 100, 410, 200, 40)

        if current_state == STATE_MENU:
            btn_create, btn_rand, btn_join = ui.draw_menu(screen, input_room_id, show_input_bar, error_message)
        
        elif current_state == STATE_GAME_OVER:
            if ui.assets.get('bg'): screen.blit(ui.assets['bg'], (0,0))
            else: screen.fill(BLACK)
            
            # Draw semi-transparent overlay
            overlay = pygame.Surface((WIDTH, HEIGHT))
            overlay.set_alpha(200); overlay.fill(BLACK)
            screen.blit(overlay, (0,0))

            is_winner = (winner_id == net.my_id)
            res_txt = "YOU WIN!" if is_winner else "YOU LOSE!"
            col = GREEN if is_winner else RED
            ui.draw_text_shadow(screen, res_txt, ui.font_big, col, (WIDTH//2, HEIGHT//2), center=True)

            rect_back = pygame.Rect(WIDTH//2 - 50, HEIGHT//2 + 60, 100, 40)
            ui.draw_button(screen, rect_back, "EXIT")
        
        else:
            # Main Game Screens
            rect_back = ui.draw_game_ui(screen, net, current_state, is_private_room, ships_to_place, current_ship_idx)
            
            ui.draw_board_base(screen, MY_BOARD_X, MARGIN_TOP)
            ui.draw_board_base(screen, ENEMY_BOARD_X, MARGIN_TOP)

            for s in placed_ships:
                ui.draw_ship(screen, s)

            ui.draw_explosions_overlay(screen, my_board, MY_BOARD_X, MARGIN_TOP)
            ui.draw_explosions_overlay(screen, enemy_board, ENEMY_BOARD_X, MARGIN_TOP)

            # Draw ghost ship placement
            mx, my = pygame.mouse.get_pos()
            if current_state == STATE_SETUP and current_ship_idx < len(ships_to_place):
                if MY_BOARD_X < mx < MY_BOARD_X + BOARD_WIDTH_PX and MARGIN_TOP < my < MARGIN_TOP + BOARD_WIDTH_PX:
                    gx, gy = (mx - MY_BOARD_X)//GRID_SIZE, (my - MARGIN_TOP)//GRID_SIZE
                    key = f"{ships_to_place[current_ship_idx]}_{orientation}"
                    if key in ui.assets:
                        ghost = ui.assets[key].copy()
                        ghost.set_alpha(150)
                        screen.blit(ghost, (MY_BOARD_X + gx*GRID_SIZE, MARGIN_TOP + gy*GRID_SIZE))

            if current_state == STATE_CONFIRM_EXIT:
                rect_yes, rect_no = ui.draw_exit_popup(screen)

            # Notification
            if notification_timer > 0:
                notif_surf = ui.font_big.render(notification_text, True, notif_color)
                notif_rect = notif_surf.get_rect(center=(WIDTH//2, HEIGHT//2))
                screen.blit(notif_surf, notif_rect)
                notification_timer -= 1

        # --- EVENT HANDLING ---
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
                pygame.quit(); return

            if event.type == pygame.MOUSEBUTTONDOWN:
                mx, my = pygame.mouse.get_pos()

                if current_state == STATE_CONFIRM_EXIT:
                    if rect_yes and rect_yes.collidepoint(mx, my):
                        net.send({"action": "leave_room"})
                        current_state = STATE_MENU
                        net.room_id = None
                        reset_game_state()
                        show_input_bar = False
                    elif rect_no and rect_no.collidepoint(mx, my):
                        current_state = previous_state
                    continue # Stop processing other clicks

                # Back Button logic
                if current_state not in [STATE_MENU, STATE_GAME_OVER, STATE_CONFIRM_EXIT]:
                    if rect_back and rect_back.collidepoint(mx, my):
                        previous_state = current_state
                        current_state = STATE_CONFIRM_EXIT
                        continue

                if current_state == STATE_GAME_OVER:
                    if rect_back and rect_back.collidepoint(mx, my):
                        net.send({"action": "leave_room"})
                        current_state = STATE_MENU
                        net.room_id = None
                        reset_game_state()
                        winner_id = None
                        continue

                if current_state == STATE_MENU:
                    if btn_create and btn_create.collidepoint(mx, my):
                        net.send({"action": "create_room"})
                        is_private_room = True
                        show_input_bar = False
                    elif btn_rand and btn_rand.collidepoint(mx, my):
                        net.send({"action": "random_match"})
                        is_private_room = False
                        show_input_bar = False
                    elif btn_join and btn_join.collidepoint(mx, my):
                        show_input_bar = not show_input_bar
                        input_room_id = ""
                    elif show_input_bar and not input_rect.collidepoint(mx, my):
                        show_input_bar = False

                elif current_state == STATE_SETUP:
                    if MY_BOARD_X < mx < MY_BOARD_X + BOARD_WIDTH_PX and MARGIN_TOP < my < MARGIN_TOP + BOARD_WIDTH_PX:
                        gx, gy = (mx - MY_BOARD_X) // GRID_SIZE, (my - MARGIN_TOP) // GRID_SIZE
                        size = ships_to_place[current_ship_idx]
                        valid, _ = check_valid_placement(my_board, size, gx, gy, orientation)
                        
                        if valid:
                            # Place ship logic
                            s_obj = ShipObj(size, gx, gy, orientation)
                            placed_ships.append(s_obj)
                            # Mark on board
                            cells = s_obj.get_cells()
                            for cx, cy in cells: my_board[cy][cx] = 1
                            
                            current_ship_idx += 1
                            if current_ship_idx >= len(ships_to_place):
                                # Send ready
                                ships_data = [{"cells": s.get_cells()} for s in placed_ships]
                                net.send({"action": "ready", "ships": ships_data})
                                current_state = STATE_WAIT_OPPONENT

                elif current_state == STATE_PLAYING and net.turn == net.my_id:
                    if ENEMY_BOARD_X < mx < ENEMY_BOARD_X + BOARD_WIDTH_PX and MARGIN_TOP < my < MARGIN_TOP + BOARD_WIDTH_PX:
                        gx, gy = (mx - ENEMY_BOARD_X) // GRID_SIZE, (my - MARGIN_TOP) // GRID_SIZE
                        if enemy_board[gy][gx] == 0:
                            net.send({"action": "fire", "x": gx, "y": gy})

            if event.type == pygame.KEYDOWN:
                if current_state == STATE_MENU and show_input_bar:
                    if event.key == pygame.K_BACKSPACE: input_room_id = input_room_id[:-1]
                    elif event.key == pygame.K_RETURN and len(input_room_id) > 0:
                        net.send({"action": "join_room", "room_id": input_room_id})
                    elif event.unicode.isnumeric() and len(input_room_id) < 4:
                        input_room_id += event.unicode
                elif current_state == STATE_SETUP:
                    if event.key == pygame.K_r:
                        orientation = 'v' if orientation == 'h' else 'h'

        pygame.display.flip()
        clock.tick(60)

if __name__ == "__main__":
    main()