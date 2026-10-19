export const PAGE_SIZE=50;
export function storeLoadPlan(path:string):string[]{return ({'/products':['products'],'/orders':['products','orders'],'/payments':['orders','payments'],'/sales':['products','leads','queue'],'/inbox':['products','queue'],'/control':['settings'],'/settings':['settings']} as Record<string,string[]>)[path]||[];}
