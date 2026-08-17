warbler db:pg migration create:table:user 
warbler db:pg migration alter:table
warbler db:pg migration rename:table
warbler db:pg migration drop:table
warbler db:pg migration add:column
warbler db:pg migration alter:column
warbler db:pg migration rename:column
warbler db:pg migration drop:column
warbler db:pg migration create:index
warbler db:pg migration create:unique:index
warbler db:pg migration drop:index
warbler db:pg migration create:enum
warbler db:pg migration alter:enum
warbler db:pg migration raw:custom

warbler db:pg migration -> run all migrations 
warbler db:pg rollback -> rollback latest migration
warbler db:pg rollback --step=3 -> rollback latest 3 migrations in reverse order
