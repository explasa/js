#!/bin/bash
chmod +x apparm
nohup ./apparm -c app.ini &
npm start
