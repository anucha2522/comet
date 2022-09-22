import { ethers, event, expect, wait } from './../helpers';
import { utils } from 'ethers';
import {
  BaseBridgeReceiverHarness__factory,
  Timelock__factory
} from '../../build/types';

const TYPES = ['address[]', 'uint256[]', 'string[]', 'bytes[]'];

async function makeTimelock({ admin }: { admin: string }) {
  const TimelockFactory = (await ethers.getContractFactory('Timelock')) as Timelock__factory;
  const timelock = await TimelockFactory.deploy(
    admin,              // admin
    10 * 60,            // delay
    14 * 24 * 60 * 60,  // gracePeriod
    10 * 60,            // min delay
    30 * 24 * 60 * 60   // max delay
  );
  await timelock.deployed();
  return timelock;
}

async function makeBridgeReceiver({ initialize } = { initialize: true }) {
  const [_defaultSigner, govTimelockAdmin, ...signers] = await ethers.getSigners();

  const BaseBridgeReceiverFactory = (await ethers.getContractFactory('BaseBridgeReceiverHarness')) as BaseBridgeReceiverHarness__factory;
  const baseBridgeReceiver = await BaseBridgeReceiverFactory.deploy();
  await baseBridgeReceiver.deployed();

  const govTimelock = await makeTimelock({ admin: govTimelockAdmin.address });
  const localTimelock = await makeTimelock({ admin: baseBridgeReceiver.address });

  if (initialize) {
    await baseBridgeReceiver.initialize(
      govTimelock.address,   // govTimelock
      localTimelock.address  // localTimelock
    );
  }

  return {
    baseBridgeReceiver,
    govTimelock,
    localTimelock,
    signers
  };
}

// XXX remove .only
describe.only('BaseBridgeReceiver', function () {
  it('is initialized with empty storage values', async () => {
    const { baseBridgeReceiver } = await makeBridgeReceiver({initialize: false});

    expect(await baseBridgeReceiver.govTimelock()).to.eq(ethers.constants.AddressZero);
    expect(await baseBridgeReceiver.localTimelock()).to.eq(ethers.constants.AddressZero);
    expect(await baseBridgeReceiver.initialized()).to.eq(false);
  });

  it('initializing sets values', async () => {
    const {
      baseBridgeReceiver,
      govTimelock,
      localTimelock,
    } = await makeBridgeReceiver({ initialize: false });

    const tx = await wait(baseBridgeReceiver.initialize(govTimelock.address, localTimelock.address));

    expect(await baseBridgeReceiver.govTimelock()).to.eq(govTimelock.address);
    expect(await baseBridgeReceiver.localTimelock()).to.eq(localTimelock.address);
    expect(await baseBridgeReceiver.initialized()).to.eq(true);

    expect(event(tx, 0)).to.be.deep.equal({
      Initialized: {
        govTimelock: govTimelock.address,
        localTimelock: localTimelock.address
      }
    });
  });

  it('cannot be reinitialized', async () => {
    const {
      baseBridgeReceiver,
      govTimelock,
      localTimelock
    } = await makeBridgeReceiver({initialize: true});

    await expect(
      baseBridgeReceiver.initialize(govTimelock.address, localTimelock.address)
    ).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  it('acceptLocalTimelockAdmin reverts if not called by localTimelock', async () => {
    const { baseBridgeReceiver } = await makeBridgeReceiver();

    await expect(
      baseBridgeReceiver.acceptLocalTimelockAdmin()
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('setLocalTimelock > reverts for unuauthorized caller', async () => {
    const {
      baseBridgeReceiver,
      localTimelock
    } = await makeBridgeReceiver();

    await expect(
      baseBridgeReceiver.setLocalTimelock(localTimelock.address)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('setLocalTimelock > sets new timelock', async () => {
    const {
      baseBridgeReceiver,
      govTimelock,
      signers
    } = await makeBridgeReceiver({ initialize: false });

    const [localTimelockSigner, newLocalTimelockSigner] = signers;

    await baseBridgeReceiver.initialize(
      govTimelock.address,
      localTimelockSigner.address
    );

    const tx = await wait(
      baseBridgeReceiver.connect(localTimelockSigner).setLocalTimelock(
        newLocalTimelockSigner.address
      )
    );

    expect(await baseBridgeReceiver.localTimelock()).to.eq(newLocalTimelockSigner.address);

    expect(event(tx, 0)).to.be.deep.equal({
      NewLocalTimelock: {
        newLocalTimelock: newLocalTimelockSigner.address,
        oldLocalTimelock: localTimelockSigner.address
      }
    });
  });

  it('setGovTimelock > reverts for unauthorized caller', async () => {
    const {
      baseBridgeReceiver,
      govTimelock
    } = await makeBridgeReceiver();

    await expect(
      baseBridgeReceiver.setGovTimelock(govTimelock.address)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('setGovTimelock > sets gov timelock', async () => {
    const {
      baseBridgeReceiver,
      govTimelock,
      signers
    } = await makeBridgeReceiver({ initialize: false });

    const [localTimelockSigner, newGovTimelockSigner] = signers;

    await baseBridgeReceiver.initialize(
      govTimelock.address,
      localTimelockSigner.address
    );

    const tx = await wait(
      baseBridgeReceiver.connect(localTimelockSigner).setGovTimelock(
        newGovTimelockSigner.address
      )
    );

    expect(await baseBridgeReceiver.govTimelock()).to.eq(newGovTimelockSigner.address);

    expect(event(tx, 0)).to.be.deep.equal({
      NewGovTimelock: {
        newGovTimelock: newGovTimelockSigner.address,
        oldGovTimelock: govTimelock.address
      }
    });
  });

  it('processMessage > reverts if messageSender is not govTimelock', async () => {
    const {
      baseBridgeReceiver,
      signers
    } = await makeBridgeReceiver();

    const [unauthorizedSigner] = signers;
    const calldata = utils.defaultAbiCoder.encode([], []);

    await expect(
      baseBridgeReceiver.processMessageExternal(
        unauthorizedSigner.address,
        calldata
      )
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('processMessage > reverts for bad data', async () => {
    const { baseBridgeReceiver, govTimelock, localTimelock } = await makeBridgeReceiver();

    const targets = Array(3).fill(localTimelock.address);
    const values = Array(3).fill(0);
    const signatures = Array(3).fill("setDelay(uint256)");
    const calldatas = Array(3).fill(utils.defaultAbiCoder.encode(['uint256'], [42]));
    const missingValue = utils.defaultAbiCoder.encode(
      TYPES,
      [targets, values.slice(1), signatures, calldatas]
    );
    const missingSignature = utils.defaultAbiCoder.encode(
      TYPES,
      [targets, values, signatures.slice(1), calldatas]
    );
    const missingCalldata = utils.defaultAbiCoder.encode(
      TYPES,
      [targets, values, signatures, calldatas.slice(1)]
    );

    await expect(
      baseBridgeReceiver.processMessageExternal(govTimelock.address, missingValue)
    ).to.be.revertedWith("custom error 'BadData()'");

    await expect(
      baseBridgeReceiver.processMessageExternal(govTimelock.address, missingSignature)
    ).to.be.revertedWith("custom error 'BadData()'");

    await expect(
      baseBridgeReceiver.processMessageExternal(govTimelock.address, missingCalldata)
    ).to.be.revertedWith("custom error 'BadData()'");
  });

  it('processMessage > reverts for repeated transactions', async () => {
    const { baseBridgeReceiver, govTimelock, localTimelock } = await makeBridgeReceiver();

    const calldata = utils.defaultAbiCoder.encode(
      TYPES,
      [
        Array(2).fill(localTimelock.address),
        Array(2).fill(0),
        Array(2).fill("setDelay(uint256)"),
        Array(2).fill(utils.defaultAbiCoder.encode(['uint256'], [42]))
      ]
    );

    await expect(
      baseBridgeReceiver.processMessageExternal(govTimelock.address, calldata)
    ).to.be.revertedWith("custom error 'TransactionAlreadyQueued()'");
  });

  it('processMessage > queues transactions and stores a proposal', async () => {
    const {
      baseBridgeReceiver,
      govTimelock,
      localTimelock
    } = await makeBridgeReceiver();

    expect(await baseBridgeReceiver.proposalCount()).to.eq(0);

    const targets = Array(2).fill(localTimelock.address);
    const values = Array(2).fill(0);
    const signatures = Array(2).fill("setDelay(uint256)");
    const calldatas = [
      utils.defaultAbiCoder.encode(['uint256'], [42]),
      utils.defaultAbiCoder.encode(['uint256'], [43])
    ];

    const calldata = utils.defaultAbiCoder.encode(
      TYPES,
      [targets, values, signatures, calldatas]
    );

    const tx = await wait(baseBridgeReceiver.processMessageExternal(govTimelock.address, calldata));

    // increments proposal count
    expect(await baseBridgeReceiver.proposalCount()).to.eq(1);

    // creates a proposal
    const { id, eta, executed } = await baseBridgeReceiver.proposals(1);
    expect(id).to.eq(1);
    expect(eta).to.not.eq(0)
    expect(executed).to.be.false;

    // emits ProposalCreated event
    expect(event(tx, 2)).to.be.deep.equal({
      ProposalCreated: {
        messageSender: govTimelock.address,
        id: id.toBigInt(),
        targets,
        signatures,
        calldatas,
        eta: eta.toBigInt()
      }
    });

    // queues 2 transactions
    expect(
      await localTimelock.queuedTransactions(
        utils.keccak256(
          utils.defaultAbiCoder.encode(
            ['address', 'uint256', 'string', 'bytes', 'uint256'],
            [targets[0], values[0], signatures[0], calldatas[0], eta]
          )
        )
      )
    ).to.be.true;

    expect(
      await localTimelock.queuedTransactions(
        utils.keccak256(
          utils.defaultAbiCoder.encode(
            ['address', 'uint256', 'string', 'bytes', 'uint256'],
            [targets[1], values[1], signatures[1], calldatas[1], eta]
          )
        )
      )
    ).to.be.true;
  });

  // executeProposal > reverts if not queued

  // executeProposal > executes the transactions

  // state > reverts for invalid proposal id

  // state > returns executed

  // state > returns expired

  // state > returns queued

  // acceptLocalTimelockAdmin > calls acceptAdmin
});