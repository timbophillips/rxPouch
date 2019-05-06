"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const beautifulJSON_1 = require("beautifulJSON");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const dist_1 = require("../dist");
const detect_node_1 = __importDefault(require("detect-node"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
let localName = 'tasks3b';
let remoteName = 'http://localhost:5984/tasks3';
let localPathName = detect_node_1.default ? path.join(os.tmpdir(), localName) : localName;
console.log(localPathName);
// instantiate the class
let z = new dist_1.RxPouch(remoteName, localPathName);
const testPut = (doc) => {
    z.putDoc(doc).subscribe(x => {
        console.log(beautifulJSON_1.beautifulJSON(x));
    });
};
const testGet = (_id) => {
    z.getDoc(_id)
        .pipe(operators_1.catchError((error, caught) => {
        return rxjs_1.of(error);
    }))
        .subscribe(x => {
        console.log(beautifulJSON_1.beautifulJSON(x));
    });
};
const testDelete = (_ids) => {
    _ids.forEach(element => {
        z.deleteDoc(element)
            .pipe(operators_1.catchError((error, caught) => {
            return rxjs_1.of(error);
        }))
            .subscribe(x => {
            console.log(beautifulJSON_1.beautifulJSON(x));
        });
    });
};
const testCreateThenDelete = () => {
    z.putDoc({ name: '*****this one should be deleted in 2 seconds', rank: 'tick tock tick tock' })
        .pipe(operators_1.delay(2000), operators_1.concatMap(doc => {
        // console.log('<===>' + beautifulJSON(doc))
        return z.deleteDoc(doc.id);
    }))
        .subscribe(x => console.log(beautifulJSON_1.beautifulJSON(x)));
};
const testMakeWholeBunchThenFindThenDelete = () => {
    rxjs_1.interval(1000)
        .pipe(operators_1.take(5), operators_1.mergeMap(x => z.putDoc({ patient_name: '*****this one should be deleted in 5 seconds, with his mates', logged_by: 'tick tock tick tock' })), operators_1.delay(5000), operators_1.map(y => y.id), operators_1.mergeMap(d => z.deleteDoc(d)))
        .subscribe(a => console.log(beautifulJSON_1.beautifulJSON(a)));
};
const testFindAndDeleteThem = () => {
    // create the index
    z.createIndex({ index: { fields: ['name'] } })
        .pipe(operators_1.concatMap(x => {
        // log the output from the index
        console.log(beautifulJSON_1.beautifulJSON({ "mango index creation output": x }));
        // now star the find observable
        return z.findDocs({ selector: { name: { $regex: '^not' } } });
    }), 
    // we just want the _ids
    operators_1.concatMap(y => {
        return y.map(z => z._id);
    }), 
    // now delete all of them
    operators_1.concatMap(a => z.deleteDoc(a)))
        .subscribe(x => console.log(beautifulJSON_1.beautifulJSON(x)));
};
// setTimeout(testPut, 500, {
//     name: 'yes another batch of new ones created 500ms after start'
// });
// setTimeout(testCreateThenDelete, 2000);
// setTimeout(testFindAndDeleteThem, 5000)
testMakeWholeBunchThenFindThenDelete();
