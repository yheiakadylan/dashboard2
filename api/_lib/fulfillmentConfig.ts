export const merchizeConfig = {
  base_url: "https://bo-group-1-1.merchize.com/qj0tksw/bo-api",
  access_token: process.env.MERCHIZE_ACCESS_TOKEN || "",
  batch_size: 100,
};

export const printwayConfig = {
  base_url: "https://apis.printway.io/v3",
  access_token: process.env.PRINTWAY_ACCESS_TOKEN || "",
  limit: 100,
};
