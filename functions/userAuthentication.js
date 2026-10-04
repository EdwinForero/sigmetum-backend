const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRATION = process.env.JWT_EXPIRATION;
const USERNAME = process.env.ADMIN_USERNAME;
const PASSWORD = process.env.ADMIN_PASSWORD;

const users = [
  {
    id: 1,
    username: USERNAME,
    password: PASSWORD
  }
];

const userAuth = async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRATION });

  res.json({ success: true, data: { token } });
};

module.exports = { userAuth };
