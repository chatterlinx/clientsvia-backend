class JoiType {
  email() { return this; }
  min() { return this; }
  max() { return this; }
  required() { return this; }
  optional() { return this; }
  allow() { return this; }
  valid() { return this; }
  items() { return this; }
}

const string = () => new JoiType();
const boolean = () => new JoiType();
const array = () => new JoiType();

class JoiObject {
  constructor(schema) {
    this.schema = schema;
  }
  min() { return this; }
  validate(data) { return { value: data }; }
}

const object = (schema) => new JoiObject(schema);

module.exports = { string, boolean, array, object };
