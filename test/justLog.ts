import { beautifulJSON } from "beautifuljson";
import { RxPouch } from '../dist';
import isNode from 'detect-node';
import * as os from 'os';
import * as path from 'path';

let localName = 'temp-pouch';
let remoteName = 'http://localhost:5984/tasks3';

let localPathName = isNode? path.join(os.tmpdir(), localName) : localName;
console.log(localPathName);
// instantiate the class
let z = new RxPouch(
    remoteName,localPathName,
);

// output the log
z.log.subscribe(x => {
    console.clear();
    console.log(beautifulJSON(x));
});