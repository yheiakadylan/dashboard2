export const merchizeConfig = {
  base_url: "https://bo-group-2-2.merchize.com/w1fegjx/bo-api",
  access_token: process.env.MERCHIZE_ACCESS_TOKEN || "",
  batch_size: 100,
};

export const printwayConfig = {
  base_url: "https://apis.printway.io/v3",
  access_token: process.env.PRINTWAY_ACCESS_TOKEN || "",
  limit: 100,
};
