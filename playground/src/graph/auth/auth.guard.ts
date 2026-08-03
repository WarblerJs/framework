// @ts-nocheck
export const loginGuard: Guard = async context => {
    if (!context.user) {
      return new Response("Unauthorized", {
        status: 401,
      });
    }
  
    return true;
  };
