import { beautifulJSON } from "beautifulJSON";
import { RxPouch } from '../lib';

// instantiate the class
let z = new RxPouch(
    "http://localhost:5984/tasks3",
);

// output the log
z.log.subscribe(x => {
    console.clear();
    console.log(beautifulJSON(x));
});