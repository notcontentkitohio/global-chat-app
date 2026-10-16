const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Database giả lập lưu danh sách User đăng ký bằng Email
const usersDB = [];

// Discord OAuth Credentials
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '123456789';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'secret';
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback';

// Google OAuth Credentials
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback';

app.use(session({
  secret: 'notcontentkitohio_super_secret_2026',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// 1. Local Auth (Đăng nhập Email/Pass)
passport.use(new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  const user = usersDB.find(u => u.email === email);
  if (!user) return done(null, false, { message: 'Email không tồn tại' });
  if (!bcrypt.compareSync(password, user.password)) {
    return done(null, false, { message: 'Mật khẩu không đúng' });
  }
  return done(null, user);
}));

// 2. Discord Auth
passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify']
  },
  (accessToken, refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      username: profile.global_name || profile.username,
      avatar: profile.avatar 
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` 
        : `https://cdn.discordapp.com/embed/avatars/0.png`
    };
    return done(null, user);
  }
));

// 3. Google Auth
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL
  },
  (accessToken, refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      username: profile.displayName,
      avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : 'https://cdn.discordapp.com/embed/avatars/0.png'
    };
    return done(null, user);
  }
));

// Routes Đăng ký / Đăng nhập
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  if (usersDB.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email này đã được sử dụng!' });
  }
  const hashedPassword = bcrypt.hashSync(password, 10);
  const newUser = {
    id: Date.now().toString(),
    username,
    email,
    password: hashedPassword,
    avatar: 'https://cdn.discordapp.com/embed/avatars/0.png'
  };
  usersDB.push(newUser);
  req.login(newUser, err => {
    if (err) return res.status(500).json({ error: 'Lỗi đăng nhập tự động' });
    return res.json({ success: true, user: newUser });
  });
});

app.post('/api/login', passport.authenticate('local'), (req, res) => {
  res.json({ success: true, user: req.user });
});

// OAuth Routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated()) res.json(req.user);
  else res.json(null);
});

let messageHistory = [];

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e7 });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('load_history', messageHistory);
  socket.on('send_message', (data) => {
    messageHistory.push(data);
    if (messageHistory.length > 50) messageHistory.shift();
    io.emit('receive_message', data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server đang chạy tại cổng ${PORT}`);
});