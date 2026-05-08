/* UWB - TagoIO MQTT Payload Parser
 *
 * Supports:
 * 1. RAW hex string
 * 2. TagoIO payload array
 *
 * Expected MQTT payload:
 * Hex string
 */

let mqtt_payload;

// -----------------------------
// TagoIO input normalization
// -----------------------------

if (Array.isArray(payload)) {
  mqtt_payload = payload.find((data) => data.variable === "payload" || data.metadata?.mqtt_topic);
} else if (typeof payload === "string") {
  mqtt_payload = {
    variable: "payload",
    value: payload,
    metadata: {},
  };

  payload = [mqtt_payload];
}

const group = String(Date.now());

if (mqtt_payload) {
  try {
    const hex = String(mqtt_payload.value).trim();

    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error("Invalid hexadecimal payload");
    }

    const bytes = hexStringToByteArray(hex);

    if (!bytes || bytes.length === 0) {
      throw new Error("Empty payload");
    }

    const decoded = decodePayload(bytes);

    if (!decoded) {
      const type = (bytes[0] >> 4) & 0x0f;

      payload = payload.concat([
        {
          variable: "unknown_uplink_type",
          value: "0x" + type.toString(16).padStart(2, "0"),
          group,
          metadata: {
            original_payload: hex,
          },
        },
      ]);
    } else {
      const tagoData = objectToTagoIO(decoded, group);
      payload = payload.concat(tagoData);
    }
  } catch (error) {
    payload = payload.concat([
      {
        variable: "parser_error",
        value: error.message,
        group,
        metadata: {
          original_payload: mqtt_payload.value,
        },
      },
    ]);
  }
}

// -----------------------------
// TagoIO output helper
// -----------------------------

function objectToTagoIO(obj, group, prefix) {
  let result = [];

  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    const variable = prefix ? prefix + "_" + key : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "object" && item !== null) {
          result = result.concat(objectToTagoIO(item, group, variable + "_" + (index + 1)));
        } else {
          result.push({
            variable: variable + "_" + (index + 1),
            value: item,
            group,
          });
        }
      });
    } else if (typeof value === "object" && value !== null) {
      result = result.concat(objectToTagoIO(value, group, variable));
    } else {
      result.push({
        variable,
        value,
        group,
      });
    }
  });

  return result;
}

// -----------------------------
// Main decoder
// -----------------------------

function decodePayload(bytes) {
  const type = (bytes[0] >> 4) & 0x0f;

  switch (type) {
    case 0x01:
      return decodeRegistration(bytes);

    case 0x02:
      return decodeHeartbeat(bytes);

    case 0x06:
      return decodeSingleConfigurationParameter(bytes);

    default:
      return null;
  }
}

// -----------------------------
// type: 0x1 Registration
// -----------------------------

function decodeRegistration(bytes) {
  var data = {};

  data.type = "RegistrationMessage";

  data.softwareVersion = "V" + (((bytes[1] << 8) & 0xff00) | (bytes[2] & 0xff)).toString(16).toUpperCase().padStart(4, "0");

  data.hardwareVersion = "V" + (((bytes[3] << 8) & 0xff00) | (bytes[4] & 0xff)).toString(16).toUpperCase().padStart(4, "0");

  data.loraClockSyncInterval = (((bytes[9] << 8) & 0xff00) | (bytes[10] & 0xff)) + "s";

  data.loraClockSyncFreq = ((bytes[11] << 24) | (bytes[12] << 16) | (bytes[13] << 8) | bytes[14]) / 1000000;

  data.loraClockSyncSF = bytes[15];

  var loraClockSyncBWValue = bytes[16];

  if (loraClockSyncBWValue == 0) {
    data.loraClockSyncBW = "500kHz";
  } else if (loraClockSyncBWValue == 1) {
    data.loraClockSyncBW = "250kHz";
  } else if (loraClockSyncBWValue == 2) {
    data.loraClockSyncBW = "125kHz";
  }

  data.heartbeatInterval = (((bytes[17] << 8) & 0xff00) | (bytes[18] & 0xff)) * 30 + "s";

  return data;
}

// -----------------------------
// type: 0x2 Heartbeat
// -----------------------------

function decodeHeartbeat(bytes) {
  var data = {};

  data.type = "HeartbeatMessage";
  data.batteryVoltage = (bytes[5] * 0.1).toFixed(1) + "V";
  data.uwbPositioningCount = bytes[7];
  data.temperature = (((bytes[10] << 8) & 0xff00) | (bytes[11] & 0xff)) + "°C";

  return data;
}

// -----------------------------
// type: 0x6 Single Configuration Parameter
// -----------------------------

function decodeSingleConfigurationParameter(bytes) {
  var data = {};

  data.type = "ConfigurationParameterResponse";

  var parameter = [];
  let byteLength = bytes.length;
  var index = 0;

  while (index + 1 < byteLength) {
    var commandBitField = {};
    var parameterTypevalue = bytes[index + 1] & 0xff;

    commandBitField.parameterType = parameterTypevalue.toString(16).toUpperCase().padStart(2, "0");

    var commandBitFieldLength = getCommandBitFieldLength(parameterTypevalue);
    var parameterValue = getParameterValue(bytes, index, commandBitFieldLength);

    commandBitField.parameterValue = parameterValue;
    commandBitField.name = getParameterName(parameterTypevalue);
    commandBitField.parameterDefinition = getParameterDefinition(parameterTypevalue, parameterValue);

    index = index + commandBitFieldLength;
    parameter.push(commandBitField);
  }

  data.parameter = parameter;
  return data;
}

// -----------------------------
// getParameterValue hexString
// -----------------------------

function getParameterValue(bytes, index, length) {
  var hexString = "";

  for (var i = 2; i <= length; i++) {
    var hex = (bytes[index + i] & 0xff).toString(16).toUpperCase();
    hexString += hex.padStart(2, "0");
  }

  return hexString;
}

// -----------------------------
// getCommandBitFieldLength
// -----------------------------

function getCommandBitFieldLength(parameterType) {
  let lengths = {
    0x00: 3,
    0x01: 3,
    0x32: 2,
    0x33: 2,
    0x52: 3,
    0x53: 5,
    0x54: 2,
    0x55: 2,
    0x5e: 5,
  };

  return lengths[parameterType] ?? 0;
}

// -----------------------------
// Parameter Name
// -----------------------------

function getParameterName(parameterType) {
  let name = {
    0x00: "SoftwareVersion",
    0x01: "HBPeriod",
    0x32: "CFMMSG",
    0x33: "HBCOUNT",
    0x52: "LoRaCLKSYNCInterval",
    0x53: "LoRaCLKSYNCFrequency",
    0x54: "LoRaCLKSYNCSF",
    0x55: "LoRaCLKSYNCBW",
    0x5e: "UwbAdInterval",
  };

  return name[parameterType] ?? "No matching parameter names";
}

// -----------------------------
// Parameter Definition
// -----------------------------

function getParameterDefinition(parameterType, parameterValue) {
  var val = parseInt(parameterValue, 16);

  let name = {
    0x00: "SoftwareVersion",
    0x01: val * 30 + "s, The interval of the heartbeat message, unit: 30s",
    0x32: val + " The interval of messages that must be acknowledged",
    0x33: val + " The number of heartbeat ACK that the tracker misses",
    0x52: val + "s, LoRa clock synchronization interval, unit: 1s",
    0x53: val + " LoRa clock synchronization frequency",
    0x54: val + " LoRa clock synchronization spreading factor",
    0x55: val + " LoRa clock synchronization bandwidth",
    0x5e: val / 1000 + "s, The anchor's UWB advertises interval, unit: 1ms",
  };

  return name[parameterType] ?? "No matching parameter names";
}

// -----------------------------
// Common helpers
// -----------------------------

function hex2float(num) {
  num = num >>> 0;

  var sign = num & 0x80000000 ? -1 : 1;
  var exponent = (num >>> 23) & 0xff;
  var fraction = num & 0x7fffff;

  if (exponent === 0xff) {
    return fraction === 0 ? sign * Infinity : NaN;
  }

  if (exponent === 0) {
    return fraction === 0 ? sign * 0 : sign * Math.pow(2, -126) * (fraction / 0x800000);
  }

  return sign * Math.pow(2, exponent - 127) * (1 + fraction / 0x800000);
}

function asciiToHex(str) {
  var hexString = "";

  for (let i = 0; i < str.length; i++) {
    var hex = str.charCodeAt(i).toString(16);
    hexString += hex.padStart(2, "0");
  }

  return hexString;
}

function hexStringToByteArray(hexString) {
  var byteArray = [];

  for (let i = 0; i < hexString.length; i += 2) {
    byteArray.push(parseInt(hexString.substr(i, 2), 16));
  }

  return byteArray;
}

function timestampToTime(timestamp) {
  const date = new Date(timestamp);

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  const second = date.getSeconds().toString().padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
