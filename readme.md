# max-control

> Control the ELV Max! heating system with node.js

## note

max-control is a fork of [ivesdebruycker/maxcube](https://github.com/ivesdebruycker/maxcube), which seems to be actively developed, so please use it instead of this fork.

## usage

```
var MaxCube = require('./index');
var mc = new MaxCube('192.168.1.110', 62910);

mc.on('connected', function () {
  console.log('ready');

  setTimeout(function () {
    console.log('send');
    mc.setTemperature('0087ae', 'manual', 19);
  }, 5000);
});

mc.on('update', function (data) {
  console.log('got update');
  console.log(data);
});
```
