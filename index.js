var EventEmitter = require('events').EventEmitter;
var net = require('net');
var fs = require('fs');
var util = require('util');

util.inherits(MaxCube, EventEmitter);

function padLeft(nr, n, str){
  return Array(n-String(nr).length+1).join(str||'0')+nr;
}

function MaxCube(ip, port, heartbeatInterval) {
  this.ip = ip;
  this.port = port;
  this.interval = heartbeatInterval || 20000;
  this.isConnected = false;
  this.busy = false;
  this.callback = null;
  this.dutyCycle = 0;
  this.memorySlots = 0;

  this.rooms = [];
  this.devices = {};
  this.deviceCount = 0;
  this.client = new net.Socket();
  var self = this;
  this.client.on('error', function(err){
    self.emit('error', err);
  });

  this.client.on('data', this.onData.bind(this));

  this.connect();
}

MaxCube.prototype.connect = function () {
  if (!this.isConnected) {
    this.client.connect(this.port, this.ip, function() {
      //console.log('Connected');
      this.isConnected = true;
      this.emit('connected');
    }.bind(this));
  } else {
    this.send('l:\r\n');
  }

  setTimeout(this.connect.bind(this), this.interval);
};

MaxCube.prototype.send = function (message, callback) {
  if (!this.busy) {
    //console.log('Sending command: ' + message.substr(0,1));
    this.busy = true;
    this.client.write(message, 'utf-8', callback);
  }
};

MaxCube.prototype.onData = function (data) {
  data = data.toString('utf-8');
  data = data.split('\r\n');
  data.forEach(function (line) {
    if (line.length > 0) {
      var commandType = line.substr(0, 1);
      var payload = line.substring(2);
      //console.log('Data received: ' + commandType);
      var dataObj = this.parseCommand(commandType, payload);
      //console.log(dataObj);
    }
  }.bind(this));
  this.busy = false;
  this.emit('update', this.devices);
};

MaxCube.prototype.getDeviceType = function (deviceId) {
  var type = null;
  switch (deviceId) {
    case 0:
      type = 'Cube';
      break;
    case 1:
      type = 'Heating Thermostat';
      break;
    case 2:
      type = 'Heating Thermostat Plus';
      break;
    case 3:
      type = 'Wall mounted Thermostat';
      break;
    case 4:
      type = 'Shutter Contact';
      break;
    case 5:
      type = 'Push Button';
      break;
    default:
      type = 'unknown';
      break;
  }
  return type;
};

MaxCube.prototype.parseCommand = function (type, payload) {
  var data = null;
  switch (type) {
    case 'H':
      data = this.parseCommandHello(payload);
      break;
    case 'M':
      data = this.parseCommandMetadata(payload);
      break;
    case 'C':
      data = this.parseCommandDeviceConfiguration(payload);
      break;
    case 'L':
      data = this.parseCommandDeviceList(payload);
      break;
    case 'S':
      data = this.parseCommandSendDevice(payload);
      break;
    default:
      console.log('Unknown command type: ' + type);
      break;
  }
  return data;
};

MaxCube.prototype.parseCommandHello = function (payload) {
  var payloadArr = payload.split(",");

  var dataObj = {
    serial: payloadArr[0],
    address: payloadArr[1],
    firmware: payloadArr[2],
    connectionId: payloadArr[4],
    dutyCycle: parseInt(payloadArr[5], 16),
    freeMemorySlots: parseInt(payloadArr[6], 16),
    date: 2000 + parseInt(payloadArr[7].substr(0, 2), 16) + '-' + parseInt(payloadArr[7].substr(2, 2), 16) + '-' + parseInt(payloadArr[7].substr(4, 2), 16),
    time: parseInt(payloadArr[8].substr(0, 2), 16) + ':' + parseInt(payloadArr[8].substr(2, 2), 16) ,
    stateTime: payloadArr[9],
    ntpCounter: payloadArr[10],
  };
  this.dutyCycle = dataObj.dutyCycle;
  this.memorySlots = dataObj.freeMemorySlots;
  this.emit('status', {
    dutyCycle: this.dutyCycle,
    memorySlots: this.memorySlots
  });
  return dataObj;
};

MaxCube.prototype.parseCommandDeviceConfiguration = function (payload) {
  var payloadArr = payload.split(",");
  var decodedPayload = new Buffer(payloadArr[1], 'base64');

  var address = decodedPayload.slice(1, 4).toString('hex');
  var devicetype = this.getDeviceType(parseInt(decodedPayload[4].toString(10)));
  if ( (devicetype == 'Heating Thermostat' || devicetype == 'Heating Thermostat Plus') && this.devices[address]) {
    this.devices[address].comfortTemperature = parseInt(decodedPayload[18].toString(10)) / 2;
    this.devices[address].ecoTemperature = parseInt(decodedPayload[19].toString(10)) / 2;
    this.devices[address].maxTemperature = parseInt(decodedPayload[20].toString(10)) / 2;
    this.devices[address].minTemperature = parseInt(decodedPayload[21].toString(10)) / 2;
    this.devices[address].temperatureOffset = parseInt(decodedPayload[22].toString(10)) / 2;
    this.devices[address].windowOpenTemperature = parseInt(decodedPayload[23].toString(10)) / 2;
    return this.devices[address];
  }
  return null;
};

MaxCube.prototype.parseCommandMetadata = function (payload) {
  var payloadArr = payload.split(",");

  var decodedPayload = new Buffer(payloadArr[2], 'base64');
  var room_count = parseInt(decodedPayload[2].toString(10));
  var currentIndex = 3;

  // parse rooms
  for (var i = 0; i < room_count; i++) {
    var roomData = {};
    roomData.roomId = parseInt(decodedPayload[currentIndex].toString(10));
    var room_length = parseInt(decodedPayload[currentIndex + 1].toString(10));
    roomData.name = String.fromCharCode.apply(null, decodedPayload.slice(currentIndex + 2, currentIndex + 2 + room_length));
    roomData.groupAddress = decodedPayload.slice(currentIndex + 2 + room_length, currentIndex + room_length + 5).toString('hex');
    this.rooms.push(roomData);
    currentIndex = currentIndex + room_length + 5;
  }

  if (currentIndex < decodedPayload.length) {
    this.deviceCount = parseInt(decodedPayload[currentIndex].toString(10));

    for (var j = 0; j < this.deviceCount; j++) {
      var deviceData = {};
      deviceData.type = this.getDeviceType(parseInt(decodedPayload[currentIndex + 1].toString(10)));
      deviceData.address = decodedPayload.slice(currentIndex + 2, currentIndex + 5).toString('hex');
      deviceData.serial = decodedPayload.slice(currentIndex + 5, currentIndex + 13).toString();
      device_length = parseInt(decodedPayload[currentIndex + 15].toString(10));
      deviceData.name = decodedPayload.slice(currentIndex + 16, currentIndex + 16 + device_length).toString('utf-8');
      deviceData.roomId = parseInt(decodedPayload[currentIndex + 16 + device_length].toString(10));
      this.devices[deviceData.address] = deviceData;
      currentIndex = currentIndex + 16 + device_length;
    }
  }
  return {
    rooms: this.rooms,
    devices: this.devices
  };
};

MaxCube.prototype.parseCommandDeviceList = function (payload) {
  var decodedPayload = new Buffer(payload, 'base64');
  var currentIndex = 1;
  var actualTemp = 0;
  for(var i = 1; i <= this.deviceCount; i++) {
    var data = '';
    var length = parseInt(decodedPayload[currentIndex - 1].toString());
    var address = decodedPayload.slice(currentIndex, currentIndex + 3).toString('hex');
    if (this.devices[address] && (this.devices[address].type == 'Heating Thermostat' || this.devices[address].type == 'Heating Thermostat Plus') ) {
      this.devices[address].valve = decodedPayload[currentIndex + 6];
      this.devices[address].setpoint = parseInt(decodedPayload[currentIndex + 7].toString(10)) / 2;
      /* byte 5 from http://www.domoticaforum.eu/viewtopic.php?f=66&t=6654
5          1  12          bit 4     Valid              0=invalid;1=information provided is valid
                          bit 3     Error              0=no; 1=Error occurred
                          bit 2     Answer             0=an answer to a command,1=not an answer to a command
                          bit 1     Status initialized 0=not initialized, 1=yes
                               
                          12  = 00010010b
                              = Valid, Initialized
*/
      this.devices[address].initialized = !!(decodedPayload[currentIndex + 4] & (1 << 1));
      this.devices[address].fromCmd = !!(decodedPayload[currentIndex + 4] & (1 << 2));
      this.devices[address].error = !!(decodedPayload[currentIndex + 4] & (1 << 3));
      this.devices[address].valid = !!(decodedPayload[currentIndex + 4] & (1 << 4));
      this.devices[address].dstActive = !!(decodedPayload[currentIndex + 5] & 8);
      this.devices[address].gateway_known = !!(decodedPayload[currentIndex + 5] & 16);
      this.devices[address].panelLocked = !!(decodedPayload[currentIndex + 5] & 32);
      this.devices[address].linkError = !!(decodedPayload[currentIndex + 5] & 64);

      data = padLeft(decodedPayload[currentIndex + 5].toString(2), 8);
      this.devices[address].battery = parseInt(data.substr(0, 1)) ? 'low' : 'ok';
      var mode;
      switch (data.substr(6, 2)) {
        case '00': mode = "auto"; break;
        case '01': mode = "manu"; break;
        case '10': mode = "vacation"; break;
        case '11': mode = "boost"; break;
      }
      if(typeof mode == "string") {
        this.devices[address].mode = mode;
      }

      if(decodedPayload[currentIndex + 8] !== 0 || decodedPayload[currentIndex + 9] !== 0) {
        actualTemp = (decodedPayload[currentIndex + 8] * 256 + decodedPayload[currentIndex + 9]) / 10;
      } else {
        actualTemp = undefined;
      }
      this.devices[address].actualTemperature = actualTemp;

    } else if (this.devices[address] && this.devices[address].type === 'Wall mounted Thermostat') {
      actualTemp = (decodedPayload[currentIndex + 11] + (decodedPayload[currentIndex + 7] & 0x80) * 2) / 10;
      this.devices[address].actualTemperature = actualTemp;
      this.devices[address].battery = parseInt(data.substr(0, 1)) ? 'low' : 'ok';
    } else if (this.devices[address] && this.devices[address].type === 'Shutter Contact') {
      data = padLeft(decodedPayload[currentIndex + 5].toString(2), 8);
      this.devices[address].state = parseInt(data.substr(6, 1)) ? 'open' : 'closed';
      this.devices[address].battery = parseInt(data.substr(0, 1)) ? 'low' : 'ok';
    }
    currentIndex = currentIndex + length + 1;
  }
  return this.devices;
};

MaxCube.prototype.parseCommandSendDevice = function (payload) {
  var payloadArr = payload.split(",");

  var dataObj = {
    accepted: payloadArr[1] == '0',
    duty_cycle: parseInt(payloadArr[0], 16),
    free_memory_slots: parseInt(payloadArr[2], 16)
  };
  this.dutyCycle = dataObj.duty_cycle;
  this.memorySlots = dataObj.free_memory_slots;
  this.emit('status', {
    dutyCycle: this.dutyCycle,
    memorySlots: this.memorySlots
  });
  this.emit('response', dataObj);
  return dataObj;
};

MaxCube.prototype.setTemperature = function (rfAdress, mode, temperature, callback) {
  var reqTempHex, reqTempBinary, reqRoomHex;
  if (!this.isConnected) {
    callback(new Error("Not connected"));
    return;
  }

  var date_until = '0000';
  var time_until = '00';

  // 00 = Auto weekprog (no temp is needed, just make the whole byte 00)
  // 01 = Permanent
  // 10 = Temporarily
  var modeBin;
  switch (mode) {
    case 'auto':
      modeBin = '00';
      break;
    case 'manu':
      modeBin = '01';
      break;
    case 'boost':
      modeBin = '11';
      break;
    default:
      callback(new Error('Unknown mode: ' + mode));
      return false;
  }

  var device = this.devices[rfAdress];
  if(!device) {
    callback(new Error("Could not find a device with this rfAdress!"));
    return;
  }
  var roomId = device.roomId; 

  
  reqRoomHex = padLeft(roomId.toString(16), 2);

  if(mode == 'auto' && (typeof temperature === "undefined" || temperature === null)) {
    reqTempHex = '00';
  } else {
    reqTempBinary = modeBin + ("000000" + (temperature * 2).toString(2)).substr(-6);
    reqTempHex = parseInt(reqTempBinary, 2).toString(16);    
  }

  var payload = new Buffer('000440000000' + rfAdress + reqRoomHex + reqTempHex + date_until + time_until, 'hex').toString('base64');
  var data = 's:' + payload + '\r\n';

  this.send(data, function(err) {
      if(err && callback) { 
        callback(err); 
        callback = null;
      }
  });

  this.once('response', function(res) {
    if(!callback) {
      return;
    }
    if(res.accepted) {
      callback(null);
    } else {
      var reason = "";
      if(res.free_memory_slots === 0) {
        reason = ": Too many commands send, the cube has no memoery slots left.";
      }
      callback(new Error('Command was rejected' + reason));
    }
    callback = null;
  });

};

MaxCube.prototype.sendResetError = function (rfAdress, callback) {
  var payload = new Buffer(rfAdress).toString('base64');
  var data = 'r:01,' + payload + '\r\n';
  this.send(data, callback);
};

module.exports = MaxCube;
