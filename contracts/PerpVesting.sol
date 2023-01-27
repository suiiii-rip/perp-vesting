// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PerpVesting {

  event TermsAccepted(
    address indexed receiver
  );

  event Deposited(
    address indexed depositor,
    uint amount
  );

  event Withdrawn(
    address indexed depositor,
    uint amount
  );

  event Claimed(
    address indexed receiver,
    uint amount
  );

  address public immutable sender;
  address public immutable receiver;

  uint public immutable periodLength;
  uint public immutable lockedPeriods;
  uint public immutable periodAmount;

  uint public depositedAmount;
  uint public depositedAllTime;
  uint public claimedAllTime;

  uint public startedAt;
  uint public lastClaimAt;

  IERC20 public token;

  using SafeERC20 for IERC20;

  constructor(address _token, address _receiver,
              uint _periodLength, uint _lockedPeriods,
              uint _periodAmount) {

    token = IERC20(_token);
    sender = msg.sender;
    receiver = _receiver;

    periodLength = _periodLength;
    lockedPeriods = _lockedPeriods;
    periodAmount = _periodAmount;
  }


  function acceptTerms() external {
    require(msg.sender == receiver, "Not the receiver");
    require(startedAt == 0, "Contract already accepted");
    startedAt = block.timestamp;
    emit TermsAccepted(receiver);
  }

  /// @notice sender deposits amount
  /// @param _amount admount the sender deposits
  function deposit(uint _amount) external {

    depositedAmount += _amount;
    depositedAllTime += _amount;

    token.safeTransferFrom(msg.sender, address(this), _amount);

    emit Deposited(msg.sender, _amount);
  }

  /// @notice The sender withdraws unlocked funds
  /// @param _amount amount the sender wants to withdraw
  /// @return Withdrawn amount
  function withdraw(uint _amount) external returns (uint) {
    require(msg.sender == sender, "Not the sender");

    // contract not started yet
    if (startedAt == 0) {
      require(depositedAmount >= _amount, "Not enough funds");
      depositedAmount -= _amount;

      token.safeTransfer(sender, _amount);
      emit Withdrawn(msg.sender, _amount);
      return _amount;
    }

    // contract started
    // uint locked = periodAmount * lockedPeriods;
    // TODO move to new function and create withdrawable()
    uint completedPeriods = (block.timestamp - startedAt) / periodLength;

    uint claimedPeriods = lastClaimAt == 0 ? 0 : (lastClaimAt - startedAt) / periodLength;
    uint lockedPeriods_ = completedPeriods + lockedPeriods;
    uint periodDiff = lockedPeriods_ - claimedPeriods;

    uint lockedAmount = periodDiff * periodAmount;
    uint maxWithdraw = depositedAmount < lockedAmount ? 0 : depositedAmount - lockedAmount;

    require(maxWithdraw >= _amount, "Insufficient unlocked funds available");

    depositedAmount -= _amount;
    token.safeTransfer(sender, _amount);

    emit Withdrawn(msg.sender, _amount);
    return _amount;
  }

  /// @notice Amount of claimable funds by the receiver
  /// @return amount of claimable funds by the receiver
  function claimable() public view returns (uint) {

    uint claimedPeriods = lastClaimAt == 0 ? 0 : (lastClaimAt - startedAt) / periodLength;
    uint periodsPassed = (block.timestamp - startedAt) / periodLength;


    uint claimablePeriods = periodsPassed - claimedPeriods;
    uint claimable_ = claimablePeriods * periodAmount;

    return claimable_;
  }

  /// @notice The sender claims all available funds
  /// @return amount of claimed funds
  function claim() external returns (uint) {
    require(msg.sender == receiver, "Not the receiver");
    require(startedAt > 0, "Contract not accepted yet");

    uint claimable_ = claimable();
    require(claimable_ > 0, "Nothing to claim");

    lastClaimAt = block.timestamp;
    claimedAllTime += claimable_;
    depositedAmount -= claimable_;

    token.safeTransfer(receiver, claimable_);
    emit Claimed(msg.sender, claimable_);
    return claimable_;
  }


}
