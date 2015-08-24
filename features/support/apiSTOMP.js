var
  config = require('./config')(),
  stomp = require('stomp-client'),
  uuid = require('node-uuid'),
  q = require('q'),
  KUZZLE_EXCHANGE = 'amq.topic';

module.exports = {
  world: null,
  stompClient: undefined,
  stompConnected: undefined,
  clientId: uuid.v1(),
  subscribedRooms: {},
  responses: null,

  init: function (world) {
    var
      stompUrl = config.stompUrl.replace('stomp://', '').split(':'),
      deferredConnection;

    if ( !this.stompClient ) {
      this.stompClient = new stomp(stompUrl[0], stompUrl[1], 'guest', 'guest', '1.0', '/');

      deferredConnection = q.defer();
      this.stompConnected = deferredConnection.promise;
      this.stompClient.connect(function (sessionId) {
        deferredConnection.resolve(sessionId);
      });
    }
    this.world = world;
  },

  disconnect: function () {
    if (this.stompClient) {
      this.stompClient.disconnect();
      this.stompClient = null;
    }
  },

  create: function (body, persist) {
    var
      topic = ['write', this.world.fakeCollection, 'create'].join('.'),
      msg = {
        persist: persist,
        body: body
      };

    return publish.call(this, topic, msg);
  },

  get: function (id) {
    var
      topic = ['read', this.world.fakeCollection, 'get'].join('.'),
      msg = {
        _id: id
      };

    return publish.call(this, topic, msg);
  },

  search: function (filters) {
    var
      topic = ['read', this.world.fakeCollection, 'search'].join('.'),
      msg = {
        body: filters
      };

    return publish.call(this, topic, msg);
  },

  update: function (id, body) {
    var
      topic = ['write', this.world.fakeCollection, 'update'].join('.'),
      msg = {
        _id: id,
        body: body
      };

    return publish.call(this, topic, msg);
  },

  count: function (filters) {
    var
      topic = ['read', this.world.fakeCollection, 'count'].join('.'),
      msg = {
        body: filters
      };

    return publish.call(this, topic, msg);
  },

  deleteById: function (id) {
    var
      topic = ['write', this.world.fakeCollection, 'delete'].join('.'),
      msg = {
        _id: id
      };

    return publish.call(this, topic, msg);
  },

  deleteByQuery: function (filters) {
    var
      topic = ['write', this.world.fakeCollection, 'deleteByQuery'].join('.'),
      msg = {
        body: filters
      };

    return publish.call(this, topic, msg);
  },

  deleteCollection: function () {
    var
      topic = ['admin', this.world.fakeCollection, 'deleteCollection'].join('.'),
      msg = {};

    return publish.call(this, topic, msg);
  },

  putMapping: function () {
    var
      topic = ['admin', this.world.fakeCollection, 'putMapping'].join('.'),
      msg = {
        body: this.world.schema
      };

    return publish.call(this, topic, msg);
  },

  bulkImport: function (bulk) {
    var
      topic = ['bulk', this.world.fakeCollection, 'import'].join('.'),
      msg = {
        body: bulk
      };

    return publish.call(this, topic, msg);
  },

  subscribe: function (filters) {
    var
      topic = ['subscribe', this.world.fakeCollection, 'on'].join('.'),
      msg = {
        body: filters
      };

    return publishAndListen.call(this, topic, msg);
  },

  unsubscribe: function (room) {
    var
      topic = ['subscribe', this.world.fakeCollection, 'off'].join('.'),
      msg = {
        requestId: room,
        clientId: this.subscribedRooms[room].clientId
      };

    if (this.stompClient.subscriptions[this.subscribedRooms[room].topic]) {
      this.stompClient.unsubscribe(this.subscribedRooms[room].topic);
    }
    delete this.subscribedRooms[room];
    return publish.call(this, topic, msg, false);
  },

  countSubscription: function () {
    var
      topic = ['subscribe', this.world.fakeCollection, 'count'].join('.'),
      rooms = Object.keys(this.subscribedRooms),
      msg = {
        body: {
          roomId: this.subscribedRooms[rooms[0]].roomId
        }
      };

    return publish.call(this, topic, msg);
  }
};

var publish = function (topic, message, waitForAnswer) {
  var
    deferred = q.defer(),
    listen = (waitForAnswer === undefined) ? true : waitForAnswer,
    destination = ['/exchange', KUZZLE_EXCHANGE, topic].join('/'),
    messageHeader = {
      'content-type': 'application/json'
    };

  if (!message.clientId) {
    message.clientId = uuid.v1();
  }

  this.stompConnected
    .then(function () {
      if (listen) {
        messageHeader['reply-to'] = uuid.v1();
        this.stompClient.subscribe('/queue/' + messageHeader['reply-to'], function (body, headers) {
          var unpacked = JSON.parse(body);
          if (unpacked.error) {
            deferred.reject(unpacked.error);
          }
          else {
            deferred.resolve(unpacked);
          }

          this.stompClient.unsubscribe(headers.destination);
        }.bind(this));
      }
      else {
        deferred.resolve({});
      }

      this.stompClient.publish(destination, JSON.stringify(message), messageHeader);
    }.bind(this))
    .catch(function (error) {
      deferred.reject(error);
    });

  return deferred.promise;
};

var publishAndListen = function (topic, message) {
  var
    deferred = q.defer();

  message.clientId = uuid.v1();

  publish.call(this, topic, message)
    .then(function (response) {
      var topic = '/topic/' + response.result.roomId;

      this.subscribedRooms[response.result.roomName] = { roomId: response.result.roomId, topic: topic, clientId: message.clientId };

      this.stompClient.subscribe(topic, function (body) {
        this.responses = JSON.parse(body);
      }.bind(this));

      deferred.resolve(response);
    }.bind(this))
    .catch(function (error) {
      deferred.reject(error);
    });

  return deferred.promise;
};