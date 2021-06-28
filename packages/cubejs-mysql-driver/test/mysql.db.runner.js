const MySqlDriver = require('../src/MySqlDriver');

const createDriver = (c) => new MySqlDriver({
  host: c.getHost(),
  user: 'root',
  password: process.env.TEST_DB_PASSWORD || 'Test1test',
  port: c.getMappedPort(3306),
  database: 'mysql',
});

module.exports = {
  createDriver,
};
