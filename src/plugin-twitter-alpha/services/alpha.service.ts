import { Scraper } from 'agent-twitter-client';
import { SolanaService } from './solana.service.ts';
import { elizaLogger, Service, ServiceType } from '@elizaos/core';
import { ICotAgentRuntime } from '../../types/index.ts';

interface TwitterUser {
  id: string;
  username: string;
  name: string;
  bio?: string;
}

interface RaydiumPool {
  tvl: number;
  day?: {
    volume: number;
  };
  price: number;
  openTime: number;
}

interface PoolData {
  wsolPool: RaydiumPool | null;
  usdcPool: RaydiumPool | null;
  wsolPoolAge: number;
  usdcPoolAge: number;
}

interface HasRaydiumPoolActivityResult {
  hasPool: boolean;
  isMintable: boolean;
  lessThanOneDay?: boolean;
  poolData: PoolData | null;
}

const accounts = process.env.TWITTER_ACCOUNTS?.split(',') || [];

export class AlphaService extends Service {
  static serviceType: ServiceType = 'alpha' as ServiceType;
  private scraper: Scraper;
  private runtime: ICotAgentRuntime;
  private accounts: string[] = accounts;
  private readonly logger = elizaLogger;
  private solanaService: SolanaService;

  async initialize(runtime: ICotAgentRuntime) {
    this.scraper = new Scraper();
    this.runtime = runtime;

    this.solanaService = new SolanaService();
    await this.startMonitoring();
  }

  getInstance(): AlphaService {
    return AlphaService.getInstance();
  }

  async login() {
    const {
      TWITTER_USERNAME,
      TWITTER_PASSWORD,
      TWITTER_EMAIL,
      TWITTER_2FA_SECRET,
      TWITTER_RETRY_LIMIT,
    } = process.env;
    if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
      throw new Error('Twitter credentials are missing in environment variables');
    }

    let retries = TWITTER_RETRY_LIMIT ? parseInt(TWITTER_RETRY_LIMIT) : 3;
    const cachedCookies = await this.scraper.getCookies();
    if (cachedCookies && cachedCookies.length > 0) {
      this.logger.info('🍪 Using cached cookies...');
      await this.scraper.setCookies(cachedCookies);
      return;
    }

    this.logger.log('🔑 Waiting for Twitter login...');
    while (retries > 0) {
      try {
        if (await this.scraper.isLoggedIn()) {
          this.logger.info('✅ Successfully logged in using cookies.');
          break;
        } else {
          await this.scraper.login(
            TWITTER_USERNAME,
            TWITTER_PASSWORD,
            TWITTER_EMAIL,
            TWITTER_2FA_SECRET,
          );
          if (await this.scraper.isLoggedIn()) {
            this.logger.info('✅ Successfully logged in.');
            await this.scraper.setCookies(await this.scraper.getCookies());
            break;
          }
        }
      } catch (error) {
        this.logger.error(`❌ Login attempt failed: ${error.message}`);
      }
      retries--;
      this.logger.error(`🔁 Retrying login... (${retries} attempts left)`);
      if (retries === 0) {
        throw new Error('Twitter login failed after maximum retries.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async getUserId(username: string): Promise<string | null> {
    try {
      this.logger.info(`🔍 Fetching user ID for ${username}...`);
      const userId = await this.scraper.getUserIdByScreenName(username);
      if (!userId) throw new Error('User ID not found');
      return userId;
    } catch (error) {
      this.logger.error(`❌ Error fetching user ID for ${username}:`, error);
      return null;
    }
  }

  async getFollowing(username: string): Promise<TwitterUser[]> {
    try {
      const userId = await this.getUserId(username);
      if (!userId) {
        throw new Error(`❌ Unable to fetch user ID for ${username}`);
      }

      this.logger.info(`🔍 Fetching full following list for ${username} (ID: ${userId})...`);
      const followingUsers: TwitterUser[] = [];

      for await (const profile of this.scraper.getFollowing(userId, 100000)) {
        followingUsers.push({
          id: profile.userId,
          username: profile.username,
          name: profile.name,
          bio: profile.biography || '', // Store bio for filtering pump signals
        });
      }

      this.logger.info(`✅ Retrieved ${followingUsers.length} following users for ${username}.`);
      return followingUsers;
    } catch (error) {
      this.logger.error(`❌ Error fetching follows for ${username}:`, error);
      return [];
    }
  }

  async checkForNewFollowing(username: string): Promise<TwitterUser[]> {
    const latestFollowing = await this.getFollowing(username);

    // Replace pool.query with database adapter
    const storedFollowingIds = await this.runtime.databaseAdapter.getStoredFollowing(username);
    const storedFollowingSet = new Set(storedFollowingIds);

    const newFollows = latestFollowing.filter((f) => !storedFollowingSet.has(f.id));

    for (const newFollow of newFollows) {
      // Replace pool.query with database adapter
      await this.runtime.databaseAdapter.insertTwitterFollowing({
        username,
        following_id: newFollow.id,
        following_username: newFollow.username,
        bio: newFollow.bio,
      });

      this.logger.info(
        `🚀 ${username} just followed ${newFollow.username} (${newFollow.id}) - Bio: ${newFollow.bio}`,
      );

      // Evaluate if this is an alpha opportunity
      await this.evaluatePotentialAlpha(newFollow);
    }
    return newFollows;
  }

  async getBestRaydiumPool(tokenMint: string): Promise<any | null> {
    try {
      const poolType = 'all';
      const poolSortField = 'volume30d'; // Sorting by highest trading volume in 30 days
      const sortType = 'desc';
      const pageSize = 1000;
      const page = 1;

      const baseUrl = 'https://api-v3.raydium.io/pools/info/mint';
      const url = new URL(baseUrl);
      url.searchParams.append('mint1', tokenMint);
      url.searchParams.append('poolType', poolType);
      url.searchParams.append('poolSortField', poolSortField);
      url.searchParams.append('sortType', sortType);
      url.searchParams.append('pageSize', pageSize.toString());
      url.searchParams.append('page', page.toString());

      const response = await fetch(url.toString());
      if (!response.ok) {
        elizaLogger.error(
          `❌ Error fetching Raydium pools for ${tokenMint}: ${response.statusText}`,
        );
        return null;
      }

      const data = await response.json();
      elizaLogger.log(url.toString());

      if (!data.success || !data.data?.data || data.data.data.length === 0) {
        elizaLogger.info(`❌ No pools found for token: ${tokenMint}`);
        return null;
      }

      let pools = data.data.data;

      const wsolAddress = 'So11111111111111111111111111111111111111112';
      const usdcAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      const filteredPools = pools.filter(
        (pool: any) =>
          pool.mintA.address === wsolAddress ||
          pool.mintB.address === wsolAddress ||
          pool.mintA.address === usdcAddress ||
          pool.mintB.address === usdcAddress,
      );

      if (filteredPools.length === 0) {
        elizaLogger.info(`❌ No SOL/USDC pools found for token: ${tokenMint}`);
        return null;
      }

      filteredPools.sort((a: any, b: any) => Number(b.tvl) - Number(a.tvl));
      const bestPool = filteredPools[0];

      const pool = {
        poolId: bestPool.id,
        marketId: bestPool.marketId,
        baseMint: bestPool.mintA.address,
        baseSymbol: bestPool.mintA.symbol,
        quoteMint: bestPool.mintB.address,
        quoteSymbol: bestPool.mintB.symbol,
        price: bestPool.price,
        tvl: bestPool.tvl,
        volume24h: bestPool.day?.volume || 0,
        feeRate: bestPool.feeRate,
        lpMint: bestPool.lpMint?.address || null,
        openTime: bestPool.openTime,
      };

      elizaLogger.info(`✅ Best SOL/USDC pool selected for ${tokenMint}: ${JSON.stringify(pool)}`);
      return pool;
    } catch (error) {
      elizaLogger.error(`❌ Error selecting best pool: ${error}`);
      return null;
    }
  }

  private async getRaydiumPoolData(
    tokenMint: string,
  ): Promise<HasRaydiumPoolActivityResult | undefined> {
    try {
      const poolType = 'all';
      const poolSortField = 'volume30d';
      const sortType = 'desc';
      const pageSize = 1000;
      const page = 1;

      const baseUrl = 'https://api-v3.raydium.io/pools/info/mint';
      const url = new URL(baseUrl);
      url.searchParams.append('mint1', tokenMint);
      url.searchParams.append('poolType', poolType);
      url.searchParams.append('poolSortField', poolSortField);
      url.searchParams.append('sortType', sortType);
      url.searchParams.append('pageSize', pageSize.toString());
      url.searchParams.append('page', page.toString());

      const response = await fetch(url.toString());
      if (!response.ok) {
        elizaLogger.info(`Error fetching Raydium pool for ${tokenMint}: ${response.statusText}`);
        return undefined;
      }

      const data = await response.json();
      const isMintable = await this.solanaService.isTokenMintable(tokenMint);

      if (!data.success || !data.data?.data || data.data.data.length === 0) {
        elizaLogger.info(`No pools found for token: ${tokenMint}`);
        return {
          hasPool: false,
          isMintable,
          poolData: null,
        };
      }

      const pools = data.data.data;
      const now = Math.floor(Date.now() / 1000);

      const wsolAddress = 'So11111111111111111111111111111111111111112';
      const usdcAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      const wsolPool = pools.find(
        (pool: any) => pool.mintA.address === wsolAddress || pool.mintB.address === wsolAddress,
      );
      const usdcPool = pools.find(
        (pool: any) => pool.mintA.address === usdcAddress || pool.mintB.address === usdcAddress,
      );

      const wsolPoolAge = wsolPool ? (now - Number(wsolPool.openTime)) / 86400 : 0;
      const usdcPoolAge = usdcPool ? (now - Number(usdcPool.openTime)) / 86400 : 0;

      // Log all the detailed information
      elizaLogger.info(`Pool Analysis for ${tokenMint}:
    • Token Status:
      - Mintable: ${isMintable ? '✅' : '❌'}
  
    • WSOL Pool Status: ${wsolPool ? '✅' : '❌'}
      ${
        wsolPool
          ? `- Pool Age: ${wsolPoolAge.toFixed(2)} days
      - TVL: ${wsolPool.tvl?.toLocaleString() || 'N/A'}
      - 24h Volume: ${wsolPool.day?.volume?.toLocaleString() || 'N/A'}
      - Price: ${wsolPool.price || 'N/A'}`
          : ''
      }
  
    • USDC Pool Status: ${usdcPool ? '✅' : '❌'}
      ${
        usdcPool
          ? `- Pool Age: ${usdcPoolAge.toFixed(2)} days
      - TVL: ${usdcPool.tvl?.toLocaleString() || 'N/A'}
      - 24h Volume: ${usdcPool.day?.volume?.toLocaleString() || 'N/A'}
      - Price: ${usdcPool.price || 'N/A'}`
          : ''
      }`);

      return {
        hasPool: !!(wsolPool || usdcPool),
        isMintable,
        lessThanOneDay: wsolPoolAge < 1 || usdcPoolAge < 1, // keeping for compatibility
        poolData: {
          wsolPool,
          usdcPool,
          wsolPoolAge,
          usdcPoolAge,
        },
      };
    } catch (error: any) {
      elizaLogger.info(`Error checking Raydium pool for ${tokenMint}: ${error.message}`);
      return undefined;
    }
  }

  extractTokenMintFromBio(bio: string): string | null {
    if (!bio) return null;

    const words = bio.split(/\s+/); // Split by whitespace
    const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // Rough Solana address pattern

    // Find a token address that contains "pump"
    for (const word of words) {
      if (word.toLowerCase().includes('pump') && solanaAddressRegex.test(word)) {
        return word;
      }
    }

    return null; // No valid token found
  }

  async evaluatePotentialAlpha(newFollow: TwitterUser) {
    if (!newFollow.bio) return;

    // Fetch profile details
    const profile = await this.scraper.getProfile(newFollow.username);

    const tokenMint = this.extractTokenMintFromBio(newFollow.bio);
    if (!tokenMint) {
      elizaLogger.info(`No pump-related token found in @${newFollow.username}'s bio`);
      return;
    }

    // Get Raydium pool status
    const raydiumData = await this.getRaydiumPoolData(tokenMint);
    if (!raydiumData) {
      elizaLogger.info(`Unable to fetch Raydium pool data for token ${tokenMint}`);
      return;
    }

    elizaLogger.info(`Complete analysis for @${newFollow.username}:
    • Profile Information:
      - Username: @${newFollow.username}
      - Name: ${profile.name || 'N/A'}
      - Followers: ${profile.followersCount?.toLocaleString() || 0}
      - Following: ${profile.followingCount?.toLocaleString() || 0}
      - Total Tweets: ${profile.tweetsCount?.toLocaleString() || 0}
      - Account Created: ${new Date(profile.joined).toLocaleDateString()}
      - Bio: ${profile.biography || 'N/A'}
  
    • Token Information:
      - Token Mint: ${tokenMint}
      - Is Mintable: ${raydiumData.isMintable ? '✅' : '❌'}
      - Has Any Pool: ${raydiumData.hasPool ? '✅' : '❌'}
  
    ${
      raydiumData.poolData
        ? `• Pool Details:
      - WSOL Pool: ${raydiumData.poolData.wsolPool ? `✅ (${raydiumData.poolData.wsolPoolAge.toFixed(2)} days old)` : '❌'}
      - USDC Pool: ${raydiumData.poolData.usdcPool ? `✅ (${raydiumData.poolData.usdcPoolAge.toFixed(2)} days old)` : '❌'}`
        : ''
    }`);
  }

  async startMonitoring(intervalMinutes: number = 5) {
    this.logger.info('🚀 Starting Twitter Follow Monitoring...');
    await this.login();
    for (const account of this.accounts) {
      await this.checkForNewFollowing(account);
    }
    setInterval(
      async () => {
        for (const account of this.accounts) {
          await this.checkForNewFollowing(account).catch((error) =>
            this.logger.error(`❌ Error monitoring ${account}:`, error),
          );
        }
      },
      intervalMinutes * 60 * 1000,
    );
  }

  async cleanup() {
    this.logger.info('🛑 Cleaning up...');
    // The database adapter cleanup is handled elsewhere, so we can remove the pool.end()
  }
}
