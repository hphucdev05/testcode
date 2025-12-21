# client/game_logic.py
from .constants import GRID_COUNT

class ShipObj:
    def __init__(self, size, x, y, orient):
        self.size = size
        self.x = x
        self.y = y
        self.orient = orient

    def get_cells(self):
        cells = []
        if self.orient == 'h':
            for i in range(self.size):
                cells.append((self.x + i, self.y))
        else:
            for i in range(self.size):
                cells.append((self.x, self.y + i))
        return cells

def is_ship_sunk(ship, board):
    """Kiểm tra xem tàu đã bị bắn nát hết chưa dựa trên board"""
    ship_cells = ship.get_cells()
    for cx, cy in ship_cells:
        # Nếu ô chưa bị bắn trúng (giá trị 3 là HIT/SUNK)
        if board[cy][cx] != 3:
            return False
    return True

def check_valid_placement(board, size, gx, gy, orientation):
    valid = True
    cells_to_check = []
    
    if orientation == 'h':
        if gx + size > GRID_COUNT:
            valid = False
        else:
            cells_to_check = [(gx + k, gy) for k in range(size)]
    else:
        if gy + size > GRID_COUNT:
            valid = False
        else:
            cells_to_check = [(gx, gy + k) for k in range(size)]
            
    if valid:
        # Check chồng lấn (1 là có tàu)
        for x, y in cells_to_check:
            if board[y][x] == 1:
                valid = False
                break
                
    return valid, cells_to_check

def reset_board():
    return [[0]*GRID_COUNT for _ in range(GRID_COUNT)]