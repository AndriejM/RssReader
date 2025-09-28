package pl.andriejsoft.rssreader.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import pl.andriejsoft.rssreader.document.Config;
import pl.andriejsoft.rssreader.document.User;
import pl.andriejsoft.rssreader.service.UserService;

import java.util.List;

@RestController
@RequestMapping("/user")
public class UserController {

    @Autowired
    private UserService userService;

    @GetMapping("/findAll")
    public List<User> getUsers() {

        return userService.findAll();
    }

    @PostMapping("/add")
    public String saveUser(@RequestBody User user) {
        userService.save(user);
        return "Added Successfully";
    }

    @DeleteMapping("/delete/{uuid}")
    public String deleteUser(@PathVariable String uuid){
        userService.deleteByUuid(uuid);
        return "Deleted Successfully";
    }
}
