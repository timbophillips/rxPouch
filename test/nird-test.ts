import { beautifulJSON } from "beautifuljson";
import { RxPouch } from '../dist';
import isNode from 'detect-node';
import * as os from 'os';
import * as path from 'path';

let localName = 'temp-pouch2';
let remoteName = 'http://localhost:5984/nird-test';

let localPathName = isNode? path.join(os.tmpdir(), localName) : localName;
console.log(localPathName);
// instantiate the class
let z = new RxPouch(
    remoteName,localPathName,
);

z.rxView("patients/umrns").subscribe(x => console.log(beautifulJSON(x)));