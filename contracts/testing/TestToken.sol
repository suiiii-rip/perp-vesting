// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {

  constructor() ERC20("TestToken", "Test") {
    _mint(msg.sender, 1000 ether);

  }

}
