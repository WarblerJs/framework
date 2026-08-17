
export interface RequestContextData {
    user: {
        id:string
    },
    session: {
        id: string
    }
}

export interface AppRequest {
  readonly context: RequestContextData;
}
// declare module "@warbler/http" {
//   interface RequestContextData {
//     user: {
//         userId: string
//     };
//     session: {
//         id: string
//     };
//   }
// }