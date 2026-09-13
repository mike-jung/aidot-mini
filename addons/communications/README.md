# Optional communication adapters

Install these dependencies only when your application needs MQTT or Socket.IO.
Run from this directory:

```sh
npm ci --omit=dev --ignore-scripts
```

MQTT.js 5.15.2 and Socket.IO 4.8.3 are pinned in the package lock. These adapters
are not automatically included in Linux runtime packages or Android assets.
Bundle their dependencies explicitly when your integration uses them.

## MQTT telemetry

```javascript
import {mqttTelemetry} from './mqtt.mjs';
const channel = mqttTelemetry({
  url: 'mqtts://broker.example.internal:8883',
  deviceId: 'robot-001',
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
});
channel.publish({battery: 75, pose: {x: 1, y: 2}});
// On shutdown: await channel.close();
```

The adapter uses `aidot/devices/<deviceId>/status` and `/telemetry`. Configure the
prefix and unique device identity for your broker. Supply credentials and CA
configuration externally. Remote plaintext brokers are rejected.

Telemetry uses QoS 0, no retention and a ten-second expiry. Offline or congested
publishing returns false rather than accumulating stale telemetry. This module
does not execute MQTT orders. Commands need a separate durable and authorized
contract with IDs, expiry, acknowledgements and actual robot outcomes.

## Socket.IO telemetry

Pass an existing Node HTTP/HTTPS server to
`socketTelemetry({server, origins, authorize, snapshot, maxClients})`.
Use exact allowed origins and implement `authorize(auth, request)` against your
current session/token store. It returns `{id: '...'}` or null and must support
permission revocation.

Clients request `snapshot` with an ACK callback. `await channel.publish(value)`
sends a volatile `telemetry` event. Inputs are limited to 16 KiB; snapshots and
telemetry to 8 KiB. Authentication and snapshot callbacks have two-second limits.
Concurrent publishing returns false. No state-changing command event is exposed.

`channel.close()` also closes the supplied HTTP server through Socket.IO. Call it
from the component that owns that server's lifecycle. The default console does
not include a Socket.IO client bundle.

## Adapter checks

With Mosquitto available, install test dependencies and run:

```sh
npm ci --ignore-scripts
node --test test.mjs
```

Set `MOSQUITTO_BIN` if the broker executable is outside PATH. Tests use a local
temporary broker and Socket.IO client/server. Verify your production broker TLS,
ACLs, device identities and application client behavior separately.
