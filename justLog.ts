import { beautifulJSON } from "./beautifulJSON";
import { rxPouch } from './rxPouch';

// instantiate the class
let z = new rxPouch(
    "http://localhost:5984/tasks",
);

// output the log
z.log.subscribe(x => {
    console.clear();
    console.log(beautifulJSON(x));
});

