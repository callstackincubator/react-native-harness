const JsonReporter = require('metro/private/lib/JsonReporter');
class CustomReporter extends JsonReporter {
  constructor() {
    super(process.stdout);
  }
}
module.exports = CustomReporter;
