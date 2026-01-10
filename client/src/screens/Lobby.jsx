import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketProvider';
import './Lobby.css';

const Lobby = () => {
  const [email, setEmail] = useState('');
  const [room, setRoom] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const navigate = useNavigate();
  const socket = useSocket();

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isJoining) return;

    if (!email || !room) {
      alert('Please enter both email and room number');
      return;
    }

    if (!email.includes('@')) {
      alert('Please enter a valid email format');
      return;
    }

    setIsJoining(true);

    try {
      // Lưu vào localStorage
      localStorage.setItem('userEmail', email);
      localStorage.setItem('userRoom', room);
      localStorage.setItem('currentRoom', room);

      console.log(`🚀 Joining room ${room} as ${email}`);

      // Navigate to room
      navigate(`/room/${room}`);

    } catch (error) {
      console.error('Error joining room:', error);
      alert('Failed to join room. Please try again.');
      setIsJoining(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && email && room && !isJoining) {
      handleSubmit(e);
    }
  };

  return (
    <div className="lobby-page">
      <div className="lobby-container">
        <h1>Video Connect</h1>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="name@example.com"
              required
              disabled={isJoining}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="room">Room Number</label>
            <input
              type="text"
              id="room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="e.g. 101, design-sync"
              required
              disabled={isJoining}
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            disabled={isJoining || !email || !room}
          >
            {isJoining ? (
              <>Joining... <div className="spinner"></div></>
            ) : (
              'Join Room'
            )}
          </button>
        </form>

        <div className="instructions">
          <h3>Getting Started</h3>
          <ol>
            <li>Enter your workspace email</li>
            <li>Define a room name/number</li>
            <li>Connect with your peers instantly</li>
            <li>Features: 4K Video, P2P Files, Screen Share</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default Lobby;