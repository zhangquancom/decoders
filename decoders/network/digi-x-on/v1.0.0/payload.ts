const data = payload.find((x) => x.variable === "payload");
const port = payload.find((x) => x.variable === "port");

// If we got "payload" and no "port", assume "payload.value" is a JSON string
if (data && (port === undefined || port === null)) {
  try {
    const parsed = JSON.parse(data.value);

    // Payload Parser must end with an Array of TagoIO data objects
    // (per TagoIO docs about payload being what gets stored)
    if (Array.isArray(parsed)) {
      payload = parsed;
    } else {
      console.error("Parsed JSON is not an array. Keeping original payload.");
    }
  } catch (e) {
    console.error("Invalid JSON in payload.value. Keeping original payload.", e);
  }
}
