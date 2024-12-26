const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRATION = process.env.JWT_EXPIRATION;
const USERNAME = process.env.ADMIN_USERNAME || 'SigmetumA.Management';
const PASSWORD = process.env.ADMIN_PASSWORD || '$2b$10$egV8vl6ea2OMZ6qAaj15MOKfPzN4gxA9PzsGZ87NElpyJuANt/n.K';

const users = [
  {
    id: 1,
    username: USERNAME,
    password:PASSWORD
  }
];

/*
const encryptPassword = async (password) => {
  const saltRounds = 10;
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log('Contraseña encriptada:', hashedPassword);
    return hashedPassword;
  } catch (error) {
    console.error('Error al encriptar la contraseña:', error);
  }
};

const password = 'password123';
console.log(encryptPassword(password));
*/

const userAuth = async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ message: 'Credenciales incorrectas' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ message: 'Credenciales incorrectas' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRATION });

  res.json({ token });
};

module.exports = { userAuth };