import { OnDeleteAction, PgDefault, PgTypes } from "../core/pg";


export const UserModel  = {
    id: PgTypes.Bytea,
    uuid: PgTypes.Uuid,
    userID: {
        type: PgTypes.VarChar(),
        default: PgDefault.Null,
        //references: '"users"',
        onDelete: OnDeleteAction.Cascade,
    },
    type: PgTypes.Numeric(7,3)
}
 

// @ts-nocheck
export const WlbPg = {
    user: {
        findUnique: (id:number) => 9
    }
}

WlbPg.user.findUnique(5);








