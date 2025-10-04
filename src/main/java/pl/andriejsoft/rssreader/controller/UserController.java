package pl.andriejsoft.rssreader.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import pl.andriejsoft.rssreader.entity.UserEntity;
import pl.andriejsoft.rssreader.service.UserService;

import java.util.List;

@RestController
@RequestMapping("/user")
public class UserController {

    @Autowired
    private UserService userService;

    @GetMapping("/findAll")
    public List<UserEntity> getUsers() {
        return userService.findAll();
    }

    @PostMapping("/add")
    public String saveUser(@RequestBody UserEntity user) {
        userService.save(user);
        return "Added Successfully";
    }

    @DeleteMapping("/delete/{id}")
    public String deleteUser(@PathVariable Long id){
        userService.deleteById(id);
        return "Deleted Successfully";
    }
}
