// @ts-nocheck
import { Repository } from '@warbler/core';
import { query,transactions,ALL } from '@warbler/db';
import { Profile,User } from '@db/generated';

@Repository()
export default class AuthRepo {

    async findUserByUsername(username: string) {
        /*
         ** this query will be converted to SQL by the ORM and executed against the database.
         ** @Query: SELECT * FROM User WHERE username = ?
        */
        const result = await query({
            SELECT: ALL ,
            FROM: User,
            WHERE: { username }
        })
        return result[0] || null;
    }

    async findUserProfile(userId: number) {
       /*
         ** this query will be converted to SQL by the ORM and executed against the database.
         ** @Query: SELECT *.user,*.profile FROM User
         ** LEFT JOIN Profile ON User.id = Profile.userId
         ** WHERE user.id = ?
        */
        const result = await query({
            SELECT: ALL ,
            FROM: User,
            JOIN: [
                joinLeft(Profile, User.id, Profile.userId),
            ],
            WHERE: { id: userId }
        })
        return result[0] || null;
    }

    async createUser(username: string, password: string) {

        const result = await transactions(async () => {

            const result = await query({
                INSERT: User,
                VALUES: { username, password }
            });
 
            const products = await query({
                SELECT: {
                    products: ['id', 'name', 'price'],
                    profiles: ['id', 'user_id', 'bio']
                },
                FROM: Product,
                JOIN: [
                    joinLeft(Profile, User.id, Profile.userId),
                ],
                WHERE: { username }
            });
            return result;
        })

        return result;
    }
}