// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./BaseBulker.sol";

interface IWstETH {
    function wrap(uint256 _stETHAmount) external returns (uint256);
    function unwrap(uint256 _wstETHAmount) external returns (uint256);
}

contract MainnetBulker is BaseBulker {
    address payable public immutable steth;
    address payable public immutable wsteth;

    bytes32 public constant ACTION_SUPPLY_STETH = 'ACTION_SUPPLY_STETH';
    bytes32 public constant ACTION_WITHDRAW_STETH = 'ACTION_WITHDRAW_STETH';

    constructor(
        address admin_,
        address payable weth_,
        address payable steth_,
        address payable wsteth_
    ) BaseBulker(admin_, weth_) {
        steth = steth_;
        wsteth = wsteth_;
    }

    function handleAction(bytes32 action, bytes calldata data) override internal {
        if (action == ACTION_SUPPLY_STETH) {
            (address comet, address to, uint stETHAmount) = abi.decode(data, (address, address, uint));
            supplyStEthTo(comet, to, stETHAmount);
        } else {
            revert UnhandledAction();
        }
    }

    /**
     * @notice
     */
    function supplyStEthTo(address comet, address to, uint stETHAmount) internal {
        // transfer in from stETH
        ERC20(steth).transferFrom(msg.sender, address(this), stETHAmount);
        // approve stETHAmount to the wstETH contract
        ERC20(steth).approve(wsteth, stETHAmount);
        // wrap stETHAmount
        uint wstETHAmount = IWstETH(wsteth).wrap(stETHAmount);
        // approve Comet for the wstETH amount
        ERC20(wsteth).approve(comet, wstETHAmount);
        // supply
        CometInterface(comet).supplyFrom(address(this), to, wsteth, wstETHAmount);
    }
}