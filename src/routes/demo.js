const express = require('express');
const { getDemoValuations } = require('../controllers/demoController');

const router = express.Router();

router.get('/valuations', getDemoValuations);

module.exports = router;
